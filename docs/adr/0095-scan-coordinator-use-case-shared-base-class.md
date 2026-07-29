# ADR-0095: `ScanCoordinatorUseCase` — shared base class for scan orchestration

- **Status:** Accepted. Refines [ADR-0052](0052-global-scan-worker-pool.md)'s worker-pool design (now centralized, not duplicated) and supersedes the "deliberately not shared" rationale informally recorded in `FindDeadResourcesUseCase`/`FindResourceSecurityFindingsUseCase`'s doc comments (which cited [ADR-0078](0078-dead-resources-parallel-domain.md) by analogy — that ADR itself never analyzed use-case-level duplication, only domain-model and infrastructure-utility duplication).

## Context

`AnalyzeCloudWasteUseCase` (`cloud-cost-application`), `FindDeadResourcesUseCase` (`dead-resources-application`), and `FindResourceSecurityFindingsUseCase` (`resource-security-application`) each independently implemented the same orchestration: build one job per (scanner, region) pair (with a global-scope special case added when `dead-resources` and `resource-security` were built), run them through a hand-rolled worker pool bounded by `scanConcurrency` (default 12, [ADR-0063](0063-scan-concurrency-env-configurable-default-restored-to-12.md)), collect per-(scanner, region) errors without aborting other jobs, and wrap the result in `Result.ok(...)`. A direct diff showed `FindDeadResourcesUseCase` and `FindResourceSecurityFindingsUseCase` were identical modulo type names; `AnalyzeCloudWasteUseCase` shared ~75-80% of the same shape (cloud-cost has no global-scope scanners, so it lacks that branch).

Two things changed since the duplication was last deliberately accepted:

1. `mapWithConcurrency` (`shared-aws-infra-utils`) already implements the exact same worker-pool algorithm as the hand-rolled loop, but ADR-0052 explicitly ruled out using it: *"the application layer cannot import `mapWithConcurrency` from the infrastructure lib."* That constraint assumed the only shared-code seam available was `scope:infrastructure`. It does not account for a new `scope:shared` library, which `scope:application` is allowed to depend on under the existing Nx `depConstraints` ([ADR-0075](0075-nx-dep-constraints-layer-enforcement.md)).
2. `resource-security-application` became the second consumer of the exact same pattern `dead-resources-application` introduced — at which point copy-pasting a third near-identical coordinator stopped being "proving the pattern once" ([ADR-0078](0078-dead-resources-parallel-domain.md)'s stated posture for its first slice) and started being straightforward triplication.

## Decision

New library `shared-scan-coordination` (`scope:shared`, alongside `shared-kernel` and `shared-aws-infra-utils`), exporting one abstract class:

```typescript
export abstract class ScanCoordinatorUseCase<TKind extends string, TRegion extends ScannableRegion, TFinding, TSummary> {
  constructor(
    private readonly scanners: readonly ScannableScanner<TKind, TRegion, TFinding>[],
    private readonly scanConcurrency: number = DEFAULT_SCAN_CONCURRENCY,
  ) {}

  protected abstract buildSummary(findings: TFinding[], scanErrors: ScanCoordinatorError<TKind>[]): TSummary;

  async execute(request: ScanCoordinatorRequest<TRegion>): Promise<Result<TSummary>> {
    // job construction (incl. global-scope special case), mapWithConcurrency-based
    // worker pool, per-job error collection — identical to the three duplicated
    // implementations, now written once.
  }
}
```

Each domain's use case shrinks to a subclass supplying only its own aggregation:

```typescript
export class AnalyzeCloudWasteUseCase
  extends ScanCoordinatorUseCase<ResourceKind, AwsRegion, WastedResource, WastedResourcesSummary>
  implements FindWastedResourcesUseCasePort
{
  protected override buildSummary(findings, scanErrors): WastedResourcesSummary {
    // dollar-total split by category — the only part that actually differs
  }
}
```

`FindDeadResourcesUseCase`/`FindResourceSecurityFindingsUseCase` follow the same shape, aggregating `countBySeverity` instead.

**Design choices, and why:**

- **Base class + template method, not a free function or an injected collaborator.** Matches this codebase's stated preference (base class/injected collaborator over free-function utility modules) and keeps each concrete use case a single cohesive object satisfying its own domain port, rather than a use case that merely delegates to an internal helper it also has to construct and store.
- **`buildSummary` returns the complete `TSummary`, not a spread-plus-cast.** Letting the base class assemble `{ ...partial, findings, scanErrors } as TSummary` would need an `as` cast the compiler can't verify — exactly the pattern this codebase's `as`-cast heuristic ([ADR-0084](0084-typescript-as-cast-cleanup.md)) rejects. Requiring subclasses to return the whole typed object keeps every field compiler-checked.
- **`kind` flows through as a real generic parameter (`ScanCoordinatorError<TKind>`), not widened to `string`.** Because `TKind` is inferred from the scanner array passed to the constructor, `{ kind: scanner.kind, region, error }` built inside the base class's `execute()` is already exactly typed per domain (e.g. `ScanCoordinatorError<ResourceKind>`) — no cast needed to satisfy each domain's existing `ResourceScanError`/`DeadResourceScanError`/`ResourceSecurityScanError` port types, which stay untouched.
- **`TRegion` is bounded by a minimal structural `{ readonly code: string }` interface, not `AwsRegion` directly.** `scope:shared` cannot depend on `scope:domain` ([ADR-0075](0075-nx-dep-constraints-layer-enforcement.md)); genericizing the region type avoids needing to import the concrete domain type at all, while `AwsRegion` still satisfies the constraint structurally with zero changes to its own definition.
- **The three domains' `*UseCasePort` interfaces are untouched.** `AggregateAnalysisUseCase` (`mcp-server-application`) depends on those port interfaces, not on the use cases' internal implementation — this refactor is invisible to it.

**Test split:** coordinator mechanics (concurrency bound, global-scope single-job behavior, per-job error collection, partial-failure isolation) are now tested once in `shared-scan-coordination`'s own spec, against a fake domain. Each of the three application-layer specs keeps only its own aggregation tests (dollar totals / category split / severity counts) plus one smoke test confirming a real domain `kind` flows correctly through the generic base class.

**Jest resolution gotcha (recorded for the next new `scope:shared` lib):** this monorepo's tests resolve workspace packages via each project's `moduleNameMapper` mapping the package name straight to its `src/index.ts` (bypassing the built `dist/`, which is ESM and can't be `require()`-d by Jest's CJS runtime). That mapping is maintained by hand per consuming project, not generated — every `jest.config.cjs` that (transitively) imports a new shared lib needs its own two-line mapper entry added, including the new shared lib's own `jest.config.cjs` for its own dependencies (here: `shared-kernel`, `shared-aws-infra-utils`).

## Alternatives Considered

- **Free function `runScanCoordinator(scanners, regions, concurrency, aggregate)`.** Rejected per this codebase's standing preference for a base class/injected collaborator over free-function utilities when removing duplication.
- **Injected `ScanOrchestrator` collaborator**, each use case keeping its own `execute()` and calling `orchestrator.run(...)`. More explicit about what each use case does, but adds a constructor-injected dependency three call sites now have to wire identically for no behavioral difference from the template-method version — rejected in favor of the simpler inheritance shape given there is exactly one working orchestration algorithm, not a family of interchangeable ones.
- **Leave the three duplicated, only replace each hand-rolled worker loop with `mapWithConcurrency`.** Removes the smallest slice of duplication (the loop itself, ~20 lines) while leaving job-construction, error-collection, and the per-domain `DEFAULT_SCAN_CONCURRENCY` constant duplicated three times. Rejected as an incomplete fix once a `scope:shared` seam exists to do the whole thing properly.
- **Fold the new library into `shared-kernel` or `shared-aws-infra-utils`.** Rejected: `shared-kernel` is DDD primitives (`Result`, `Entity`, `ValueObject`) with no orchestration concerns; `shared-aws-infra-utils` is AWS-adapter-facing infrastructure utilities, not an application-layer abstraction. A dedicated library keeps each existing shared lib's charter unambiguous.

## Consequences

- `AnalyzeCloudWasteUseCase`/`FindDeadResourcesUseCase`/`FindResourceSecurityFindingsUseCase` drop from 71-107 lines each to ~20-30, containing only their own aggregation logic.
- `cloud-cost-application`, `dead-resources-application`, and `resource-security-application` gain a new `scope:shared` dependency (`shared-scan-coordination`); `dead-resources-application` and `resource-security-application` additionally gain `shared-aws-infra-utils` as a transitive-through-source jest mapping (already an existing dependency of the new shared lib, not of these packages directly).
- Future scan domains (if any) get the coordinator for free — only `buildSummary` needs writing.
- Verified: `nx run-many --target={build,lint,typecheck,test} --all` green across all 17 projects, including `apps/cli` and `mcp-server-application` (unaffected — it depends only on the three domains' ports, not their application-layer implementations).
