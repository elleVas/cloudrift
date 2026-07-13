# ADR-0064: Every AWS SDK client gets its own `NodeHttpHandler`, not a shared singleton

- **Status:** Accepted (2026-07-13)

## Context

`AWS_CLIENT_DEFAULTS` ([ADR-0050](0050-aws-client-retry-backoff.md), [ADR-0058](0058-aws-client-request-timeout.md)) was a single module-level `const`, its `requestHandler: new NodeHttpHandler(...)` constructed once and spread — same object reference — into every `new XClient({ ...AWS_CLIENT_DEFAULTS, region })` across all 29 scanners. That singleton was the root cause of the `ECONNRESET`/"socket hang up" failures under concurrency investigated across ADR-0062/ADR-0063: every AWS SDK v3 client's `.destroy()` calls `this.config.requestHandler.destroy()` (confirmed by reading `@smithy/core`'s `Client.destroy()` and `@smithy/node-http-handler`'s `NodeHttpHandler.destroy()` directly), which tears down the underlying `https.Agent` — destroying every socket it currently holds, including ones other, still-in-flight clients were using, since they all shared the same handler.

Each scanner already creates and destroys one client per (scanner, region) job (`finally { client.destroy() }`). At `CLOUDRIFT_SCAN_CONCURRENCY=1` there's never more than one job in flight, so no overlap, no failures. At higher concurrency, any job finishing (and destroying "its" client) could kill every other concurrently in-flight job's connection — explaining the `ECONNRESET` pattern scaling proportionally with concurrency, identically on LocalStack and real AWS (it's 100% client-side, no network path involved), and unaffected by AWS throttling backoff, disabling HTTP keep-alive, or raising the process's file-descriptor limit (all independently ruled out first).

Confirmed with an isolated repro before applying this fix: a plain `http.Agent` shared across two request loads, `agent.destroy()` called from one while ~30 requests from the other are genuinely in flight (a slow local server holds each request open) — 30/30 fail with `code: "ECONNRESET"`, `message: "socket hang up"`. Exact match to the reported symptom.

## Decision

`AWS_CLIENT_DEFAULTS` (a shared constant) becomes `createAwsClientConfig()` (a factory function) in `libs/cloud-cost/infrastructure/aws-adapter/src/utils/client-config.ts`. Every call builds a fresh `NodeHttpHandler`, i.e. a fresh, private `https.Agent`/socket pool:

```ts
const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
```

All 29 `new XClient(...)` call sites (28 scanners plus the `CloudWatchClient` inside `CloudWatchIdleScanner`'s template method) were mechanically updated. No scanner's own destroy/error-handling logic changed — each still creates one client per job and destroys it in `finally`, exactly as before; that pattern is now safe because nothing else shares what it destroys. `AWS_CLIENT_DEFAULTS`'s other content (`maxAttempts: 3`, the 5s/30s timeouts, the `CLOUDRIFT_HTTP_KEEPALIVE` diagnostic override, the `NodeHttpHandler` diagnostics logger) is unchanged, just now built once per call instead of once per process.

## Alternatives Considered

- **Keep one shared handler, centralize its `.destroy()` after the whole worker pool finishes** (remove `client.destroy()` from all 29 scanners, add one teardown call in the CLI composition root after `AnalyzeCloudWasteUseCase.execute()` resolves). Preserves cross-scanner connection reuse for scanners hitting the same host (e.g. the ~9 EC2-based scanners in one region could share 1-2 connections instead of one each). Rejected: the performance gain is marginal — one extra TCP+TLS handshake (tens of ms) per scanner is small next to each job's own CloudWatch/pagination fan-out — while the cost is real: touching `client.destroy()` call sites *and* the matching `expect(mockDestroy).toHaveBeenCalledTimes(1)` assertions in nearly every scanner spec, plus a new cross-layer lifecycle contract ("only the composition root may destroy the shared handler") that a future 30th scanner could silently violate by copying an existing `finally { client.destroy() }` pattern — reintroducing this exact bug. The chosen per-client approach is correct by construction: there is no shared state left to corrupt.
- **Retry/backoff at the application level for socket-level errors.** Considered early, before the root cause was confirmed. Rejected once proven wrong: the SDK's own `maxAttempts: 3` already retried every failure here, and every one of the 3 attempts failed identically (`ECONNRESET` each time) — retrying more wouldn't help when the connection pool itself gets destroyed mid-burst.
- **Lower `DEFAULT_SCAN_CONCURRENCY` permanently as a workaround.** Rejected as a fix (it was the symptom-hiding path already tried in the lead-up to this ADR): masks the bug rather than fixing it, and unnecessarily slows down real scans that would otherwise be safe at higher concurrency now that the actual cause is gone.

## Consequences

- `DEFAULT_SCAN_CONCURRENCY` (`libs/cloud-cost/application/src/use-cases/analyze-cloud-waste.use-case.ts`) restored from its temporary `1` back to `12`, matching ADR-0063's original (previously unreachable, due to this bug) decision. Re-verified against real AWS the same day: identical 18 findings and 0 `scanErrors` at `CLOUDRIFT_SCAN_CONCURRENCY` = 1, 3, 5, 10, and 20, wall-clock time dropping from 12s (at 1) to 2s (at 5 and above) with no further gain past 5 on this single-region test. 12 kept as the shipped default over 20: it's the value ADR-0063 already deliberated, not a new number picked opportunistically off one test run; 20+ remains available per-run via `CLOUDRIFT_SCAN_CONCURRENCY` for whoever wants it.
- `docs/en/adding-a-resource.md` + `docs/it/aggiungere-risorsa.md`, `docs/en/technical-choices.md` + `docs/it/scelte-tecniche.md`, `docs/en/architecture.md` + `docs/it/architettura.md` updated: every `AWS_CLIENT_DEFAULTS` code reference and mention becomes `createAwsClientConfig()`. ADR-0044's code excerpt (historical, describes `CloudWatchIdleScanner` as originally written) is left as-is — ADRs are a point-in-time record, not living documentation.
- New test in `client-config.spec.ts` asserts two calls to `createAwsClientConfig()` return distinct `requestHandler` instances — the property this ADR exists to guarantee. All 302 aws-adapter tests and the full `pnpm nx run-many -t typecheck lint test build --all` pass unchanged otherwise: no scanner spec needed updating, since the mocked-SDK specs assert on `client.send()`/command shape, not on the exact config object passed to the client constructor.
