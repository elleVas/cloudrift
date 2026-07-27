# ADR-0090: Enforced coverage thresholds, computed over the whole `src/` tree

- **Status:** Accepted (2026-07-27)

## Context

No `jest.config.cjs` in the repo (16 projects) set `coverageThreshold`, so nothing failed CI regardless of how little a project was tested. An external code review (`docs/todo/todo.md`, item 1) flagged this directly: for a tool that tells a user "you're wasting $X/month," the credibility of that number depends on the credibility of the code producing it, and "we have tests" with no enforced floor is not demonstrable.

Worse, none of the 16 configs set `collectCoverageFrom` either. Jest/Istanbul only computes coverage over files touched by at least one `import` from a running spec — a source file with **zero** specs is silently absent from the denominator, not counted as 0%. Every project's coverage number looked artificially healthy (several at 98-100%) purely because untested files didn't exist as far as the coverage calculation was concerned.

## Decision

Add `collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.spec.ts', '!<rootDir>/src/index.ts']` to all 16 `jest.config.cjs` files, then add a real `coverageThreshold`:
- **80%** (statements/branches/functions/lines) for domain and application projects.
- **60%** for infrastructure projects and `apps/cli` (I/O-heavy adapter code, harder to exhaustively branch-cover; CLI wiring/wizard code has a materially different test-value ratio than pure logic).

`index.ts` barrel files are excluded from collection: they are pure `export … from './x'` re-exports with zero executable logic of their own — measuring them only penalizes projects for a file no test could meaningfully exercise (a passing import assertion proves nothing about behavior).

**The thresholds were met by writing real tests, not by calibrating the number to current coverage.** Turning on `collectCoverageFrom` first exposed the true, previously invisible picture: ~19 `cloud-cost-domain` entities and their policies (`kinesis-stream`, `mq-broker`, `msk-cluster`, the `sagemaker-*` trio, `redshift-cluster`, the `eks-*` pair, `transit-gateway-attachment`, `vpn-connection`, `workspace`, and others) had **zero** tests, several shared domain-model files (`wasted-resource.ts`, `group-by-kind.ts` in all three domains, `resource-security.ts`, `dead-resource.ts` — each carrying a real per-kind metadata map or grouping function, not just types) were untested, `aws-cost-explorer.adapter.ts` had no test at all, and the `cost-comparison`/`cost-trend` DTO mappers were untested. All of these got real spec files before the threshold was written into any config.

## Alternatives Considered

- **Set the threshold to whatever each project's current (pre-`collectCoverageFrom`) coverage already was.** Rejected — explicitly, mid-implementation, by the project owner: a threshold that just documents the status quo (including its blind spots) "non ha senso" (makes no sense) — the point of a floor is to guarantee a real minimum, not to formalize whatever already happens to be true, gaps included.
- **One global threshold for the whole workspace.** Rejected: a single number can't distinguish domain logic (cheap to fully branch-cover, no I/O) from infrastructure adapters (I/O-heavy, many defensive `?? fallback` branches for optional AWS response fields that are individually low-value to chase to 100%). Two tiers match how the codebase is already organized (hexagonal layers) rather than inventing a new axis.
- **Include `index.ts` barrels in the coverage denominator.** Rejected once inspected — every barrel in this repo is 100% re-exports (verified file by file), so counting them only adds noise (an unreachable "0%" for a file with no branches to test) without protecting anything a real bug could break.

## Consequences

All 16 projects genuinely clear their threshold today (verified via a full sequential `test --coverage` run, not parallel — parallel runs can produce a spurious CPU-contention timeout on the heavier PDF-generation specs, unrelated to coverage). `cloud-cost/infrastructure/aws-adapter`'s branch coverage (60.11%) is the tightest margin in the workspace; a future PR that adds a new branch there without a matching test could trip the gate — that is the intended behavior of a real floor, not a bug to work around by loosening the number preemptively.

The interactive wizard files (`apps/cli/src/wizard/*`) remain almost entirely untested (many at 0%) — `cli`'s aggregate still clears 60% comfortably because of the rest of the project, so this did not block the threshold, but it is a known, real gap, not a hidden one. Left for a future pass if/when it's worth the effort of mocking TTY prompt flows.

A coverage-policy badge was added to the README linking to the CI workflow, since there is no third-party coverage-reporting service (Codecov/Coveralls) wired into this repo and adding one is a separate decision with its own account/secrets setup — the badge states the enforced policy (`≥80% domain/app · ≥60% infra`), not a live percentage.
