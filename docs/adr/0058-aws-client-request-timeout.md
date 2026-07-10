# ADR-0058: AWS SDK clients get a per-request HTTP timeout, not a global scan timeout

- **Status:** Accepted (2026-07-10)

## Context

There was no timeout for an entire scan: on an account with many resources, or a hung connection to any single AWS endpoint, the tool could run for 20+ minutes with no feedback. The worker pool ([ADR-0052](0052-global-scan-worker-pool.md)) limits concurrency but not time. Investigation found the actual root cause wasn't the absence of a total-scan-time cap, but the absence of a cap on any **single HTTP request**: `AWS_CLIENT_DEFAULTS` ([ADR-0050](0050-aws-client-retry-backoff.md)) configured no `requestHandler`, and `@smithy/node-http-handler`'s own default (`DEFAULT_REQUEST_TIMEOUT = 0`) means literally no timeout — a connection that never responds can hang indefinitely, with the existing `maxAttempts: 3` retrying that same hang up to three times in the worst case.

## Decision

`AWS_CLIENT_DEFAULTS` (`libs/cloud-cost/infrastructure/aws-adapter/src/utils/client-config.ts`) adds `requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000 })`, applied to every scanner via the same shared object every `new XClient({ ...AWS_CLIENT_DEFAULTS, region })` already spreads. A timed-out request surfaces as an ordinary SDK error, retried by the existing `maxAttempts: 3`, and caught by each scanner's existing `try/catch` → `Result.fail` — zero changes to the worker pool or the result shape. `@smithy/node-http-handler` added as an explicit `package.json` dependency (previously only transitive via the `@aws-sdk/client-*` packages, not resolvable directly under pnpm without declaring it).

## Alternatives Considered

- **Per-job timeout in the worker pool.** Rejected: would require inventing a "partial/cancelled result" semantics that doesn't exist today, for marginal benefit — with 87 jobs (29 scanners × 3 regions) and a 30s per-attempt HTTP timeout, worst-case total time is already implicitly bounded.
- **A global timeout wrapping the entire `execute()` use case.** Rejected for the same reason: same missing "partial result" semantics problem, at a coarser and less precise level (kills everything in flight rather than just the one stuck request).

## Consequences

New `client-config.spec.ts` (previously absent): asserts `maxAttempts` and that `NodeHttpHandler` is constructed with the expected timeouts, via `jest.mock` (not introspecting the handler's internal config, which resolves lazily on the first real `handle()` call, not synchronously at construction — a first attempt assuming synchronous resolution failed and was corrected). 293/293 aws-adapter tests pass, `nx run cli:build` verified the bundle includes `NodeHttpHandler` and the CLI starts. See `docs/code-review-2026-07-10.md` §6.
