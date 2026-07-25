# ADR-0085: `paginate`, `createAwsClientConfig`, `mapWithConcurrency`, `AwsAdapterError` extracted into `shared-aws-infra-utils`

- **Status:** Accepted (2026-07-25)

## Context

[ADR-0078](0078-dead-resources-parallel-domain.md) deliberately duplicated `paginate()`, `createAwsClientConfig()`, and `AwsAdapterError` from `cloud-cost-infrastructure-aws-adapter` into `dead-resources-infrastructure-aws-adapter`, with an explicit threshold: "revisit (move to shared-kernel) if a third AWS-touching infrastructure lib ever needs the same utilities — not before, per this codebase's stance against premature abstraction." [ADR-0081](0081-resource-security-parallel-domain.md) (resource-security) copied the same four utilities again, restating the threshold as "revisit only if a fourth AWS-touching infrastructure lib needs the same utilities." [ADR-0080](0080-cost-analytics-extracted-from-cloud-cost.md) (cost-analytics) copied `createAwsClientConfig()` and `AwsAdapterError` a third time (it doesn't paginate or fan out concurrently, so it never needed `paginate()`/`mapWithConcurrency()`).

Counting actual infrastructure adapters that now carry a copy: `cloud-cost`, `dead-resources`, `resource-security`, and `cost-analytics` — four. The threshold both ADRs set has been crossed, not approached. A 2026-07-25 code review (`docs/todo/code-review-2026-07-25.md`) flagged this independently, undercounting slightly (missed `cloud-cost`'s own copy as one of the "N" and missed `AwsAdapterError` from the list entirely), but the underlying observation was correct: the real cost showed up when `client-config.ts`'s `connectionTimeout` had to be bumped from the 5s [ADR-0058](0058-aws-client-request-timeout.md) originally set to 10s (after real-AWS testing against `dead-resources`' `iam-instance-profile-unattached` scanner) — a change applied by hand in three separate files — and a `cost-analytics` copy of `client-config.ts` had gone stale enough to be indistinguishable from dead code until this ADR's audit confirmed it was still byte-identical.

## Decision

New Nx library `shared-aws-infra-utils` (`libs/shared/aws-infra-utils`, `scope:shared`), structured like `shared-kernel` (same `package.json` shape, `@cloudrift/source` export condition, `tsconfig.lib.json`/`tsconfig.spec.json` pair). It exports exactly the four duplicated pieces, moved verbatim (no behavior change — every duplicate was functionally identical across all four adapters; only inline comments had drifted):

- `paginate()`
- `createAwsClientConfig()`
- `mapWithConcurrency()`
- `AwsAdapterError`

`cloud-cost-infrastructure-aws-adapter`, `cost-analytics-infrastructure-aws-adapter`, `dead-resources-infrastructure-aws-adapter`, and `resource-security-infrastructure-aws-adapter` now depend on `shared-aws-infra-utils` (`scope:infrastructure → scope:shared` is already permitted by the existing `depConstraints`, [ADR-0075](0075-nx-dep-constraints-layer-enforcement.md) — no ESLint config change needed) instead of carrying their own copies. The three adapters that publicly re-exported `AwsAdapterError` from their own package (`cloud-cost`, `dead-resources`, `resource-security`) keep doing so — the re-export now points at `shared-aws-infra-utils` instead of a local file, so no consumer-facing import path changes.

## Alternatives Considered

- **Leave the duplication, just document the threshold was crossed.** Rejected: this is exactly the "revisit" both ADR-0078 and ADR-0081 already called for: the pattern isn't "reconsider forever," it's "reconsider once N is reached," and N was reached twice over.
- **Move only `AwsAdapterError` (the one the original review missed) and leave `paginate`/`client-config`/`map-with-concurrency` as-is.** Rejected: all four have the exact same "revisit at 3rd/4th lib" provenance and the exact same shape of duplication; splitting them across two decisions would be arbitrary.
- **Fold these into `shared-kernel` directly instead of a new lib.** Rejected: `shared-kernel` is domain-model plumbing (`Entity`, `ValueObject`, `Result`, `DomainError`) with zero AWS-SDK knowledge — importing `@smithy/node-http-handler` into it would give every domain-layer consumer (which never touches AWS SDK types) a transitive dependency it doesn't need. A separate `scope:shared` lib keeps `shared-kernel` AWS-agnostic while still satisfying the module-boundary rule that only `scope:infrastructure`/`scope:shared` code may depend on it.

## Consequences

**Zero behavior change.** Verified via `pnpm nx run-many --target=lint,test,typecheck,build --all --parallel`: all green across all 16 projects (0 lint errors, 4 pre-existing unrelated warnings; all test suites pass with only import-path changes in the moved spec files).

**One non-obvious fix required along the way**: each consuming project's `jest.config.cjs` hand-maintains a `moduleNameMapper` that redirects a workspace package name straight to its `src/index.ts` (so tests exercise TypeScript source through `ts-jest`, not the pre-built `dist/index.js`, which is ESM-only and would otherwise throw `SyntaxError: Unexpected token 'export'` under Jest's CommonJS module loader). This mapping is **not** auto-generated by Nx from the project graph or `tsconfig` references — adding a new shared lib as a dependency requires adding its `moduleNameMapper` entry by hand to every consumer's `jest.config.cjs` (and to `apps/cli/jest.config.cjs`, which maps every workspace lib for its own aggregating tests). Four adapter projects plus `cli` plus `shared-aws-infra-utils` itself (for its own dependency on `shared-kernel`) needed this entry added in this change.

**`cost-analytics-infrastructure-aws-adapter`'s stray `client-config.ts` copy is gone** along with the question of whether it was still live: it was, byte-for-byte identical to `cloud-cost`'s copy, confirming no drift had occurred before the consolidation.

**Same known limitation as ADR-0078/ADR-0081**: nothing beyond code review prevents a fifth AWS-touching infrastructure lib from copying these utilities again instead of depending on `shared-aws-infra-utils` — `depConstraints` permit but don't mandate the shared-lib path. Accepted for the same reason: enforcing "must reuse if available" needs either a lint rule with no obvious authoring mechanism in `@nx/enforce-module-boundaries`, or a convention documented once (here) and expected to be followed, same as every other non-mechanically-enforced convention in this codebase.
