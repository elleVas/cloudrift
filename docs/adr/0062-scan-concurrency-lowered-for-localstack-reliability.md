# ADR-0062: Scan concurrency lowered from 12 to 3; CI e2e job retries

- **Status:** Superseded by [ADR-0063](0063-scan-concurrency-env-configurable-default-restored-to-12.md) (2026-07-10)

## Context

The LocalStack e2e harness ([ADR-0002](0002-localstack-e2e-scope.md)) started failing unpredictably in CI (`e2e-localstack` job) and locally, with `"socket hang up"` errors on a random, different subset of resource kinds each run — never the same kind twice. Investigated as a possible regression from the same day's review-remediation work ([ADR-0054](0054-paginate-select-per-page-streaming.md) through [ADR-0061](0061-pdfkit-lazy-import-and-dynamic-external-detection.md)) and ruled out on two independent grounds: `@smithy/node-http-handler`'s own timeout errors carry a distinct `TimeoutError` name/message (see [ADR-0058](0058-aws-client-request-timeout.md)), architecturally incompatible with `"socket hang up"`; and temporarily reverting one of that day's scanner changes made a previously-failing kind pass while a different, untouched kind failed instead with the same error — proving the failure wasn't tied to any specific code change.

Root cause: `AnalyzeCloudWasteUseCase`'s worker pool ([ADR-0052](0052-global-scan-worker-pool.md)) defaults to 12 concurrent (scanner, region) jobs. LocalStack Community's single-process gateway can't reliably absorb that many concurrent connections — confirmed empirically by testing lower values against the same harness: 12 → 6–11 kinds failing per run; 6 → 5–7 kinds failing; 3 → ~1 kind failing (not perfectly zero, but a dramatic improvement). This reproduced identically both on a local machine (even after freeing up unrelated Docker load) and on GitHub Actions' hosted runner, ruling out "contention with other local processes" as the (sole) explanation.

## Decision

Two changes, together:

1. `DEFAULT_SCAN_CONCURRENCY` in `AnalyzeCloudWasteUseCase` (`libs/cloud-cost/application/src/use-cases/analyze-cloud-waste.use-case.ts`) lowered from `12` to `3`.
2. The `e2e-localstack` CI job (`.github/workflows/ci.yml`) retries up to 3 times (plain shell loop, no extra Action dependency) before failing the job, to absorb whatever residual flakiness remains even at the lower concurrency.

## Alternatives Considered

- **Leave concurrency at 12, only add CI retries.** Rejected: doesn't help local runs (`nx run cli:e2e-localstack` outside CI), and retrying 12-way concurrency several times is slower and still not fully reliable — the empirical data showed the failure *rate* itself needed to come down, not just be retried around.
- **Lower concurrency only, no CI retry.** Considered, but even at 3 the harness isn't perfectly reliable (~1 kind still fails on some runs) — a retry is cheap insurance against the residual flakiness without further slowing down real scans.
- **Keep 12 for production, use a lower value only in the e2e harness/CI.** Rejected: would mean the e2e harness no longer exercises the actual default concurrency path used against real AWS, undermining its value as a realistic smoke test — see [ADR-0055](0055-pdf-formatter-smoke-test.md) for the same reasoning applied elsewhere (test what really runs, not a special-cased version of it).

## Consequences

Real AWS scans are unaffected in practice: AWS's infrastructure doesn't reset connections under this level of concurrency the way LocalStack Community's single process does, and `maxAttempts: 3` in `AWS_CLIENT_DEFAULTS` ([ADR-0050](0050-aws-client-retry-backoff.md)) already absorbs real throttling. The only real-world cost is a slightly longer wall-clock time for scans against very large accounts (fewer (scanner, region) pairs in flight at once) — judged an acceptable trade for a reliable CI signal. `docs/en/architecture.md` + `docs/it/architettura.md`, `docs/en/technical-choices.md` + `docs/it/scelte-tecniche.md`, and [ADR-0052](0052-global-scan-worker-pool.md) updated to reference 3, not 12, as the default.
