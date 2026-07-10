// SPDX-License-Identifier: Apache-2.0
import { NodeHttpHandler } from '@smithy/node-http-handler';

/**
 * Default options spread into every AWS SDK v3 client created by scanners.
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
 * const ec2 = new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
 * ```
 */
export const AWS_CLIENT_DEFAULTS = {
  maxAttempts: 3,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5_000,
    requestTimeout: 30_000,
  }),
} as const;
