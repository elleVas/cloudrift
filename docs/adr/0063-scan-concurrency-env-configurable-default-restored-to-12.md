# ADR-0063: Scan concurrency default restored to 12, overridable via `CLOUDRIFT_SCAN_CONCURRENCY`; LocalStack e2e forces 1

- **Status:** Accepted (2026-07-10)
- **Supersedes:** [ADR-0062](0062-scan-concurrency-lowered-for-localstack-reliability.md)

## Context

ADR-0062 lowered `AnalyzeCloudWasteUseCase`'s default worker-pool concurrency from 12 to 3, plus a 3-attempt CI retry loop, to cut LocalStack e2e flakiness (`"socket hang up"` on a random resource kind). That ADR explicitly rejected using a lower concurrency only for the e2e harness while keeping 12 in production, on the grounds that it would make the harness stop exercising the real default concurrency path.

In practice, 3 was not enough: the `e2e-localstack` job kept failing intermittently even with the retry loop, on both GitHub Actions and locally — most recently with `ebs-snapshot` and `ebs-idle` missing from the output with no `scanErrors` reported (a silently-empty scan result, not a logged connection error). Since the harness is opt-in and not part of the required lint/test/build/typecheck pipeline, but is still relied on as a CI gate, reliability here matters more than realism of the concurrency value — and 3 concurrent (scanner, region) jobs is still enough to trip LocalStack Community's single-process gateway some of the time.

## Decision

1. `DEFAULT_SCAN_CONCURRENCY` in `AnalyzeCloudWasteUseCase` ([analyze-cloud-waste.use-case.ts](../../libs/cloud-cost/application/src/use-cases/analyze-cloud-waste.use-case.ts)) is restored to `12` — this is what real AWS scans use again.
2. A `CLOUDRIFT_SCAN_CONCURRENCY` environment variable, read once in the CLI composition root ([analyze-waste.composition.ts](../../apps/cli/src/commands/analyze-waste.composition.ts)), can override it. Empty, unset, or non-positive values fall back to the use case's own default (12).
3. `scripts/e2e-localstack.mjs` sets `CLOUDRIFT_SCAN_CONCURRENCY=1` for the CLI subprocess it spawns, unless the variable is already present in its own environment — so a developer can still experiment locally (`CLOUDRIFT_SCAN_CONCURRENCY=6 pnpm nx run cli:e2e-localstack`) without editing code.
4. The `e2e-localstack` job in `.github/workflows/ci.yml` passes through a GitHub Actions repository **Variable** (`vars.CLOUDRIFT_SCAN_CONCURRENCY`, not a secret — it's not sensitive), so the value used in CI can be tuned from the GitHub UI without a code change. If the repository variable isn't set, the env var resolves to an empty string and `scripts/e2e-localstack.mjs`'s own fallback (1) applies. The existing 3-attempt retry loop is unchanged, as cheap insurance against whatever residual flakiness remains even at concurrency 1.

This reopens the tradeoff ADR-0062 rejected — the e2e harness no longer exercises the real production concurrency by default — but the empirical evidence (3 still flaky) shows realism has to give way to a reliable CI signal. Real AWS scans (`analyze` with no `CLOUDRIFT_SCAN_CONCURRENCY` set) are unaffected: they get 12, as before ADR-0062.

## Alternatives Considered

- **Lower the shared default further (e.g. to 1) instead of adding an override.** Rejected: same objection as ADR-0062's rejected alternative — it would mean real AWS scans, which have no reliability problem at 12, pay an unnecessary latency cost with no corresponding benefit.
- **Hardcode `1` in `scripts/e2e-localstack.mjs` with no env var / GitHub Variable knob.** Rejected: the next time LocalStack's tolerance shifts (in either direction), fixing it would require a code change and a new ADR, instead of flipping one value in GitHub's UI or a local shell export.
- **Put the override behind a CLI flag (`--scan-concurrency`) instead of an env var.** Rejected: this is an internal reliability knob for the e2e harness and CI, not a user-facing feature of the `analyze` command — an env var keeps it out of `--help` and the wizard.

## Consequences

- Real AWS usage: back to concurrency 12, no behavior change from before ADR-0062.
- LocalStack e2e (local or CI): concurrency 1 by default, tunable via `CLOUDRIFT_SCAN_CONCURRENCY` (shell env locally, GitHub Actions repository Variable in CI) without touching code.
- `docs/en/architecture.md` + `docs/it/architettura.md`, `docs/en/technical-choices.md` + `docs/it/scelte-tecniche.md`, and [ADR-0052](0052-global-scan-worker-pool.md)'s README entry updated to reference 12 (env-overridable) instead of 3.
- If concurrency 1 still fails to reproduce `ebs-snapshot`/`ebs-idle` reliably, that would point away from connection-count flakiness and toward a different root cause (e.g. LocalStack seed/read eventual consistency) — not addressed by this ADR.
