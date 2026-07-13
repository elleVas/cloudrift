// SPDX-License-Identifier: Apache-2.0
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createLogger } from 'shared-kernel';

const httpLog = createLogger('cloudrift:http');

/**
 * Routes `NodeHttpHandler`'s own diagnostics (socket-pool-at-capacity
 * warnings, request/connection timeout warnings) through our namespaced
 * debug logger instead of its default `console` fallback, so they're opt-in
 * (`DEBUG=cloudrift:*`) rather than always-on noise. Added while
 * investigating the concurrency=12 "socket hang up" issue on real AWS (see
 * ADR-0063): `checkSocketUsage` already warns when a host's connection pool
 * is saturated (`sockets >= maxSockets(50) && queued >= 2×maxSockets`), which
 * directly confirms or rules out socket exhaustion as the cause — it just
 * wasn't wired to anything we'd reliably see.
 */
// Matches `@smithy/types`' `Logger` shape structurally, without adding a
// direct dependency on that package (already pulled in transitively).
const smithyLogger = {
  trace: (...args: unknown[]) => httpLog.debug('trace', { args }),
  debug: (...args: unknown[]) => httpLog.debug('debug', { args }),
  info: (...args: unknown[]) => httpLog.debug('info', { args }),
  warn: (...args: unknown[]) => httpLog.debug('warn', { args }),
  error: (...args: unknown[]) => httpLog.debug('error', { args }),
};

/**
 * `CLOUDRIFT_HTTP_KEEPALIVE=false` diagnostic override (default: on, matching
 * `NodeHttpHandler`'s own default). Tests whether a stale pooled socket
 * — reused by the client after AWS's server has already dropped it — is the
 * cause of the concurrency=12 `ECONNRESET`/"socket hang up" issue (see
 * ADR-0063 investigation): if disabling reuse makes it go away, that's
 * confirmed; if it persists, the cause is elsewhere (e.g. a local
 * network/router connection limit resetting fresh connections too).
 */
const keepAlive = process.env.CLOUDRIFT_HTTP_KEEPALIVE !== 'false';

/**
 * Default options spread into every AWS SDK v3 client created by scanners.
 * A *factory*, not a shared constant: every call builds its own
 * `NodeHttpHandler` (and therefore its own private `https.Agent`/socket
 * pool). Each scanner already creates-and-destroys one client per
 * (scanner, region) job (see every scanner's `finally { client.destroy() }`)
 * — a single shared `NodeHttpHandler` used to sit behind all of them, but
 * `Client.destroy()` tears down its `requestHandler`, so under concurrency
 * the first job to finish destroyed the connection pool every other
 * still-in-flight job was using, surfacing as `ECONNRESET`/"socket hang up"
 * that scaled with `CLOUDRIFT_SCAN_CONCURRENCY` (confirmed with an isolated
 * reproduction: 30/30 concurrent requests through a shared `http.Agent` fail
 * with that exact error the instant the agent is destroyed mid-flight). One
 * handler per client makes that failure mode structurally impossible — the
 * only cost is that two different scanners hitting the same AWS host within
 * one run each pay their own TCP+TLS handshake instead of reusing a socket,
 * which is minor next to each scan's own CloudWatch/pagination fan-out.
 *
 * `maxAttempts: 3` enables the SDK's built-in exponential backoff with jitter,
 * handling transient throttling (429) and server errors (5xx) automatically.
 *
 * `requestHandler` bounds every HTTP call: without it, neither `@aws-sdk`'s
 * nor Node's own defaults time out a connection that never responds, so a
 * single hung socket (dead network path, black-holed endpoint) can leave a
 * scan running indefinitely with no feedback. A timed-out request surfaces as
 * a normal SDK error, retried up to `maxAttempts` like any other failure, and
 * ultimately caught by each scanner's existing `try/catch` → `Result.fail`.
 *
 * Usage:
 * ```ts
 * const ec2 = new EC2Client({ ...createAwsClientConfig(), region: region.code });
 * ```
 */
export function createAwsClientConfig() {
  return {
    maxAttempts: 3,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      logger: smithyLogger,
      httpsAgent: { keepAlive },
    }),
  } as const;
}
