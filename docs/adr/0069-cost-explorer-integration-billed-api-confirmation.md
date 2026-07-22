# ADR-0069: AWS Cost Explorer integration for `cost`/`trend`, gated by an explicit billing confirmation

- **Status:** Accepted (2026-07-22)

## Context

Every scanner and every existing command (`analyze`) calls only free AWS describe/list APIs. Cost Explorer's `GetCostAndUsage` is different: AWS bills **$0.01 per API request**, regardless of how much data comes back or how the result is used. Two new user-facing capabilities were requested: `cost` (current spend vs. the same period last month, broken down by service) and `trend` (spend over the last N calendar months, optionally filtered to specific services).

This is the project's first paid API call, and the first entry point into the domain that isn't "find wasted resources."

## Decision

**New bounded capability, sibling to the existing waste-detection one, not an extension of it.** `CostComparisonSummary`/`CostTrendSummary` are new domain types (`libs/cloud-cost/domain/src/cost-comparison.ts`, `cost-trend.ts`), with their own inbound use-case ports (`CompareCostUseCasePort`, `CostTrendUseCasePort`) and a new outbound port:

```typescript
export interface CostExplorerPort {
  getCostAndUsage(params: {
    startDate: string;
    endDate: string;
    granularity: 'DAILY' | 'MONTHLY';
  }): Promise<Result<CostPeriodBucket[]>>;
}
```

`AwsCostExplorerAdapter` (`libs/cloud-cost/infrastructure/aws-adapter/src/cost-explorer/`) implements it against `@aws-sdk/client-cost-explorer`, paginating via `NextPageToken`. Cost Explorer is a **global service with a single fixed API endpoint** (`us-east-1`), unlike every other adapter in this codebase — the client is never parameterized by the regions being scanned, so `cost`/`trend` have no `--regions` flag at all.

`CompareCostUseCase` computes "the 1st of the current month through today" against the **same day-of-month range** in the previous month (not the naive "month-so-far vs. the full previous month," which would always look like a saving early in the month purely because the comparison side has more days). `CostTrendUseCase` buckets `MONTHLY` granularity over the last N months (default 6, capped at 36 via `--months`), optionally restricted by `--services` (resolved through a shorthand table, `cost-explorer-service-names.ts`, so `--services ec2 s3` works instead of requiring the exact Cost Explorer service name string).

**Mandatory confirmation before any billed call**, living in the command itself rather than only in the wizard (`confirmCostExplorerCharge()`, `apps/cli/src/wizard/cost-confirmation.wizard.ts`), so a user who invokes `cost`/`trend` directly from a script is protected exactly the same as one going through the wizard:

```
This calls AWS Cost Explorer, which bills $0.01 per request. Continue?
```

Skipped under the same three conditions the scanner-selection wizard already uses ([ADR-0041](0041-interactive-scanner-selection-wizard.md)): `--yes`/`-y` (explicit opt-in), `--silent` (already a non-interactive choice), or non-TTY/CI (never block automation waiting on input).

Both commands reuse the existing CI-gate pattern from `analyze` (`applyCostGate`, `post-analysis.ts`): `applyCostTrendGate` exits with code 2 when the spend increase exceeds `--fail-on-increase`/`config.costIncreaseAlertPercent`, mirroring `costAlertThresholdUsd`. A `null` `changePercent` (previous period was exactly $0) never trips the gate — there is no meaningful percentage against a zero baseline.

## Alternatives Considered

- **Fold cost comparison into `WastedResource`/`analyze`.** Rejected: a spend comparison isn't a "wasted resource" — there's no entity, no policy, no per-item finding, just aggregate numbers from a single external API. Forcing it through the existing domain model would mean fake entities with no basis in the ubiquitous language, the exact anti-pattern [architecture.md](../en/architecture.md#towards-multi-cloud) already rejects for multi-cloud.
- **Gate billing confirmation only inside the wizard.** Rejected: `cost --yes` aside, a user who never goes through the wizard (CI script author, power user) would spend money with zero warning the first time they run `cost`/`trend` directly. Living inside the command itself protects every call path, including future ones.
- **No confirmation at all, just document the cost.** Rejected: $0.01/request is trivial per call but not for a `trend --months 36` accidentally re-run in a loop, or for a first-time user who doesn't expect *any* cloudrift command to bill them (every other command is read-only and free). A prompt (bypassable for automation) costs nothing and prevents the surprise.

## Consequences

`@aws-sdk/client-cost-explorer` becomes a new runtime dependency. `cost`/`trend` are the only two commands in the CLI that can incur AWS charges — this is now a fact worth stating plainly in user docs, not just in the confirmation string. The new `CostExplorerPort` is a second outbound port alongside `WasteScannerPort`/`PricingPort`, following the same hexagonal shape: `cost-analytics.composition.ts` mirrors `analyze-waste.composition.ts`'s `AnalyzeDeps` injection seam (`CostAnalyticsDeps`), so `cost.command.spec.ts`/`trend.command.spec.ts` fake `CostExplorerPort` and never touch real AWS or real money in tests.
