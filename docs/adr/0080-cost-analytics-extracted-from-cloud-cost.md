# ADR-0080: Cost Explorer (`cost`/`trend`) extracted into a new `cost-analytics` domain

- **Status:** Accepted (2026-07-23)

## Context

`libs/cloud-cost/` has grown to hold two capabilities that happen to both be "about money" but share no domain model: the 44-scanner `WastedResource` waste-detection registry, and Cost Explorer-backed spend comparison/trend (`cost`/`trend` commands). Tracing the actual dependency graph: `cost.command.ts`/`trend.command.ts` import only `CompareCostUseCase`/`CostTrendUseCase` from `cloud-cost-application`, which depend only on `CostExplorerPort` from `cloud-cost-domain` — zero imports of `WasteScannerPort`, `ResourceKind`, `WastePolicy`, or the scanner registry in either direction. `CostExplorerPort`/`CostComparisonSummary`/`CostTrendSummary` (`cost-comparison.ts`, `cost-trend.ts`) depend on nothing but `shared-kernel`'s `Result`. The two capabilities were bundled by folder convenience, not by shared ubiquitous language.

This is the same bounded-context question [ADR-0078](0078-dead-resources-parallel-domain.md) already answered for `dead-resources`: a capability that shares a topic ("cost") but not a model (`WastedResource` entities, grace-period policies, scanner registry) dilutes the domain it's bundled into and doesn't benefit from being there. `dead-resources` was pulled out for exactly this reason when the shared concept was thinner than "waste." Cost Explorer's shared concept with `WastedResource` scanning is thinner still — literally nothing beyond "money."

Surfaced in passing: `toCostComparisonDto`/`toCostTrendDto` used `REPORT_DISCLAIMER` (the waste-estimate disclaimer, mentioning "estimated waste") for the `cost`/`trend` JSON output's `disclaimer` field, instead of `COST_REPORT_DISCLAIMER` (the correct, Cost-Explorer-specific text) — which the PDF formatters for the same two commands already used correctly. A latent inconsistency between the JSON and PDF disclaimer text for the same report, fixed in the same pass as the extraction since both DTOs were already being touched.

## Decision

**Three new Nx libraries**, mirroring `cloud-cost-{domain,application,infrastructure/aws-adapter}`'s and `dead-resources-{domain,application,infrastructure/aws-adapter}`'s exact layout and hexagonal layering ([ADR-0013](0013-ddd-hexagonal-plugin-model.md)):

- `cost-analytics-domain` (`libs/cost-analytics/domain`, `scope:domain`) — `CostExplorerPort`, `CostByService`, `CostPeriodBucket`, `CostComparisonSummary`, `CostServiceDelta`, `CostPeriodTotal`, `CostTrendSummary`, `CostTrendMonth`, `CompareCostUseCasePort`, `CostTrendUseCasePort`.
- `cost-analytics-application` (`libs/cost-analytics/application`, `scope:application`) — `CompareCostUseCase`, `CostTrendUseCase`, the `CostComparisonDto`/`CostTrendDto` mappers, `date-window.ts` (UTC date arithmetic, used by nothing else), and its own `constants/report-disclaimer.ts` (`COST_REPORT_DISCLAIMER`, `REPORT_CONTACT`).
- `cost-analytics-infrastructure-aws-adapter` (`libs/cost-analytics/infrastructure/aws-adapter`, `scope:infrastructure`) — `AwsCostExplorerAdapter`, `CachedCostExplorerAdapter`.

Unlike `dead-resources-domain` (which re-exports `AwsRegion` from `cloud-cost-domain`), `cost-analytics-domain` has **zero** dependency on `cloud-cost-domain` — Cost Explorer doesn't touch `AwsRegion` or any other cost-waste value object at all, so this extraction is cleaner than `dead-resources`' was.

`apps/cli`'s `cost.command.ts`, `trend.command.ts`, `cost-analytics.composition.ts`, and the four `cost-comparison.*`/`cost-trend.*` formatters now import from `cost-analytics-*` instead of `cloud-cost-*`. `resolveAwsAccountId` (STS account resolution, used by every command, not cost-specific) stays in `cloud-cost-infrastructure-aws-adapter`. `post-analysis.ts`'s `applyCostTrendGate` now imports `CostComparisonSummary` from `cost-analytics-domain` while `applyCostGate`/`writeArtifacts` keep importing `WastedResourcesSummary`/`WasteReportMeta` from `cloud-cost-{domain,application}` — the one file that genuinely spans both domains, split cleanly rather than left importing a mix from one package.

## Alternatives Considered

- **Leave Cost Explorer inside `cloud-cost`, rename the whole lib to something narrower** (e.g. `waste-resources`). Rejected: this was the option actually raised first, but it's backwards — `cloud-cost` isn't *too broad a name* for what's inside it, Cost Explorer is *the wrong thing to be inside it*. Renaming would still leave the bounded-context problem unsolved, just under a different label.
- **Keep the bundling, document the internal separation with a `cost-explorer/` subfolder.** Already the status quo before this ADR (the subfolder existed). Rejected as insufficient: folder conventions don't stop a future contributor from reaching into `cloud-cost-domain`'s `WasteScannerPort` from cost-analytics code or vice versa the way separate Nx projects + `depConstraints` ([ADR-0075](0075-nx-dep-constraints-layer-enforcement.md)) do.
- **Duplicate `createAwsClientConfig`/`AwsAdapterError` vs. sharing them.** Duplicated (~90 lines), following `dead-resources-infrastructure-aws-adapter`'s precedent from ADR-0078 — same reasoning: keeps infrastructure adapters decoupled from each other, revisit only if a fourth AWS-touching infra lib needs the same utilities.

## Consequences

**Zero behavior change** beyond the disclaimer-text fix: same CLI commands, same flags, same DTO shapes, same PDF/JSON output — only the import paths and package boundaries moved. Verified via `pnpm nx run-many --target={build,lint,test} --projects=cost-analytics-domain,cost-analytics-application,cost-analytics-infrastructure-aws-adapter,cloud-cost-domain,cloud-cost-application,cloud-cost-infrastructure-aws-adapter,cli`: all green, 0 errors (4 pre-existing warnings, unrelated). `cost-analytics-application` (2 suites/8 tests) and `cost-analytics-infrastructure-aws-adapter` (1 suite/5 tests) pass with the moved test files unchanged beyond their import lines; `cost-analytics-domain` has no spec files of its own (pure types, same as its `cost-comparison.ts`/`cost-trend.ts` had none before the move) — `passWithNoTests: true` handles this, same convention as every other domain lib. `cloud-cost-*`'s own suites (243+16+441 tests) and `cli`'s 140 tests pass unchanged, confirming no regression in the waste-scanning side.

**`libs/cloud-cost/` is now solely `WastedResource` scanning** — the 44-scanner registry, pricing layers ([ADR-0009](0009-three-pricing-layers.md)), and waste-report formatting. A future rename of `cloud-cost` to something waste-specific is a smaller, lower-risk decision now than it was before this ADR (the "but it also holds cost-analytics" argument against it is gone) — not undertaken here, since the 199-file footprint of that particular rename is still real and no rename has been requested.

**Same known limitation as ADR-0078**: `depConstraints` enforce layer isolation (`scope:domain` → `scope:shared`/`scope:domain` only) but not bounded-context isolation between sibling domain libs — nothing stops a future `cost-analytics-domain` change from importing `cloud-cost-domain` beyond convention. Accepted for the same reason ADR-0078 accepted it: a `depConstraints` tag per bounded context would need inventing and maintaining a new tag axis for a violation that hasn't happened yet.
