# cloudrift Architecture

> 🇮🇹 [Versione italiana](../it/architettura.md)

## Overview

cloudrift adopts a layered architecture inspired by **Domain-Driven Design (DDD)** and **Hexagonal Architecture** (Ports & Adapters), organized around a **plugin model**: the central domain concept is the _wasted resource_ (`WastedResource`), and every AWS resource type is a plugin (`WasteScannerPort`) that the coordinator executes generically.

This choice buys two things, and it is worth being explicit about which:

1. **Testability without AWS** — domain and application are tested with fake in-memory scanners, no SDK and no credentials.
2. **Adding new resource types at constant cost** — a new type touches neither the coordinator, nor the summary, nor the report DTO (see [adding-a-resource.md](./adding-a-resource.md)).

What it does **not** buy on its own is multi-cloud: see [Towards multi-cloud](#towards-multi-cloud) for the honest path.

The sections below describe the waste-detection path in depth, since it's the largest and oldest of the three; the CLI's other two capabilities are built the same hexagonal way and described separately: comparing/trending actual spend via Cost Explorer (`cost`/`trend`) in [Cost analytics](#cost-analytics-cost--trend), and $0 hygiene findings (unused key pairs, inactive IAM users, ...) in [Dead resources](#dead-resources-dead-resources).

---

## Layer structure

```
┌──────────────────────────────────────────────────────────┐
│                        apps/cli                          │
│   (Commander.js entry point, presenters, composition root)│
└───────────────────────────┬──────────────────────────────┘
                            │ depends on
┌───────────────────────────▼──────────────────────────────┐
│              libs/cloud-cost/application                 │
│   (generic AnalyzeCloudWasteUseCase, WasteReportDto)     │
└──────┬──────────────────────────────────────┬────────────┘
       │ depends on                           │ depends on
┌──────▼──────────────────┐   ┌──────────────▼────────────┐
│  libs/cloud-cost/domain │   │  libs/shared/kernel       │
│  (WastedResource,       │   │  (Entity, ValueObject,    │
│   entities, policies,   │   │   Result, DomainError)    │
│   ports)                │   └───────────────────────────┘
└──────▲──────────────────┘
       │ implements WasteScannerPort (×29)
┌──────┴──────────────────────────────────────────────────┐
│        libs/cloud-cost/infrastructure/aws-adapter       │
│   (AWS SDK v3 scanners, pricing, STS account resolver)  │
└─────────────────────────────────────────────────────────┘
```

**Fundamental rule:** dependencies always point inward (towards the domain). The domain knows nothing about the AWS SDK, Commander.js or pdfkit. This is enforced by tooling, not just convention: each project is tagged (`scope:shared`/`scope:domain`/`scope:application`/`scope:infrastructure`/`scope:app`) and `@nx/enforce-module-boundaries`' `depConstraints` in `eslint.config.mjs` fails the lint on any import that crosses a layer the wrong way ([ADR-0075](../adr/0075-nx-dep-constraints-layer-enforcement.md)).

---

## Why DDD and Hexagonal Architecture?

### Testability

The domain and the use case are tested **without any AWS dependency**: policies are pure functions over entities with deterministic dates, and the coordinator is tested with fake in-memory scanners (`{ kind, scan: async () => Result.ok([...]) }`). No mocking framework, fast and deterministic tests. This is the main benefit, and the one that alone justifies the ports.

### The domain is the product

The definition of "waste" — grace periods, exclusion tags, snapshots that cannot be deleted because they are bound to AMIs, traffic windows — is the real intellectual property of the tool, and it changes more often than the AWS plumbing. Keeping it in explicit domain policies, separate from SDK details, means it can evolve and be tested without touching the infrastructure. If these rules lived inside the API call filters (as they originally did), every threshold tweak would require reasoning about pagination and AWS clients.

### Extensibility at constant cost

Hexagonal here takes the shape of a plugin model: every resource type is a `WasteScannerPort`. Adding a type touches neither the coordinator, nor the summary, nor the DTO, nor the formatters (see [adding-a-resource.md](./adding-a-resource.md)) — the one remaining modification point is the `ResourceKind` union, a single line the compiler uses to walk you through every spot that needs completing.

### Substitutability — within honest limits

Ports make the **technology** replaceable, not the **domain**: you can swap the pricing source (static → AWS Pricing API) or add an entry point (CLI → HTTP) without touching the core. Multi-cloud, on the other hand, is not "free" — it requires new entities, policies and price tables — but the architecture guarantees the core stays untouched: the path is described in [Towards multi-cloud](#towards-multi-cloud).

### Separation of responsibilities

- The **domain** KNOWS what "wasted" means (entities + waste policies)
- The **application** KNOWS how to coordinate the scan and project the report
- The **infrastructure** KNOWS how to talk to AWS (pagination, clients, rate limits)
- The **CLI** KNOWS how to display it (presenters, table, PDF, JSON)

**The trade-off, stated openly:** for a tool of this size the architecture is more structure than the bare minimum — a single script would perform the same scan. It pays off because the domain (the policies) is bound to grow, because resource types accumulate over time, and because presentations multiply (terminal, PDF, JSON, a frontend tomorrow). If none of those three directions were true, this architecture would be over-engineered.

---

## The layers in detail

### 1. `shared/kernel` — Shared core

- **`Entity<TId>`**: base class for objects with identity. Its protected `deepFreeze()` recursively freezes a subclass's props (nested objects and arrays, not just the top level), used by every concrete entity so `entity.tags['x'] = 'y'` throws instead of silently mutating — see [ADR-0060](../adr/0060-entity-deep-freeze.md).
- **`ValueObject<T>`**: immutable objects with structural equality (`AwsRegion`, `CostEstimate`), compared via a recursive `deepEqual` — see [ADR-0046](../adr/0046-valueobject-deepequal.md).
- **`Result<T, E>`**: success/failure as a value, no exceptions across layers.
- **`DomainError`**: typed errors with an explicit `code`, for the domain layer.
- **`InfrastructureError`**: sibling hierarchy to `DomainError`, same shape, for infrastructure-layer failures (e.g. `AwsAdapterError`) — kept separate so the domain's error types never imply AWS knowledge it doesn't have ([ADR-0049](../adr/0049-infrastructureerror-not-domainerror.md)).
- **`createLogger(namespace)`**: zero-dependency debug logger gated by the `DEBUG` env var, writing to stderr ([ADR-0047](../adr/0047-minimal-namespaced-debug-logger.md)).

### 2. `cloud-cost/domain` — The heart of the system

#### The unifying model: `WastedResource` and `ResourceKind`

```typescript
export const RESOURCE_KINDS = [
  'ebs-volume',
  'elastic-ip',
  'rds-instance',
  'load-balancer',
  'ec2-instance',
  'ebs-snapshot',
  'nat-gateway',
  'ebs-gp2-upgrade',
  'ebs-idle',
  'ec2-underutilized',
  'rds-underutilized',
  'log-group',
  'eni-orphaned',
  's3-no-lifecycle',
  'lambda-underutilized',
  'efs-unused',
  'dynamodb-overprovisioned',
  'elasticache-idle',
  'redshift-idle-cluster',
  'opensearch-idle-domain',
  'msk-idle-cluster',
  'fsx-idle-filesystem',
  'documentdb-idle-instance',
  'neptune-idle-instance',
  'mq-idle-broker',
  'workspaces-idle',
  'vpn-connection-idle',
  'transit-gateway-idle-attachment',
  'kinesis-provisioned-idle-stream',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
// The union and RESOURCE_KIND_META in wasted-resource.ts are the source of
// truth — copy this block from there if it drifts.

export interface WastedResource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly region: AwsRegion;
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  readonly costEstimate: CostEstimate;
  readonly wasteReason: string;
}
```

`WastedResource` is **the only type that crosses the inbound boundary**: coordinator, summary, formatters and DTO depend on this interface, never on the concrete entities. The `ResourceKind` union is the single compiler-controlled extension point: adding a kind fails the typecheck until every consumer (CLI presenters, etc.) is updated. This is pragmatic OCP: one modification point exists, but it is one line and the compiler points out every spot left to complete.

#### Waste vs. optimization — `FindingCategory`

Not every finding is "delete this and stop paying": `RESOURCE_KIND_META` (`wasted-resource.ts`) attaches a `FindingCategory` (`'waste' | 'optimization'`) and an `estimated` flag to every kind:

```typescript
export const RESOURCE_KIND_META: Record<ResourceKind, ResourceKindMeta> = {
  'ebs-volume': { label: 'EBS Volumes', category: 'waste', estimated: false },
  // …
  'ebs-gp2-upgrade': { label: 'EBS gp2→gp3 Upgrades', category: 'optimization', estimated: false },
  'ec2-underutilized': { label: 'EC2 Instances (underutilized)', category: 'optimization', estimated: true },
  'rds-underutilized': { label: 'RDS Instances (underutilized)', category: 'optimization', estimated: true },
};
```

- **`waste`** — money being spent right now, eliminable by deleting/detaching the resource. Contributes to `totalWasteMonthlyUsd`, the headline number and the CI gate (`costAlertThresholdUsd`).
- **`optimization`** — a saving opportunity that keeps the resource (gp2→gp3, EC2/RDS rightsizing). Shown separately as `totalOptimizationMonthlyUsd`, never in the waste total. `ec2-underutilized` and `rds-underutilized` are additionally `estimated: true`: low CPU alone doesn't prove RAM/network (EC2) or storage I/O/connections (RDS) are equally idle, so the figure is a heuristic to verify before acting, not a committed number.

`RESOURCE_KIND_LABELS` is derived from `RESOURCE_KIND_META` (single source of truth) rather than maintained separately.

#### Entities

The 18 entities (`EbsVolume`, `ElasticIp`, `RdsInstance`, `LoadBalancer`, `Ec2Instance`, `EbsSnapshot`, `NatGateway`, `Gp2Volume`, `IdleEbsVolume`, `UnderutilizedEc2Instance`, `RdsUnderutilizedInstance`, `LogGroup`, `OrphanedEni`, `S3Bucket`, `UnderutilizedLambdaFunction`, `EfsFileSystem`, `OverprovisionedDynamoDbTable`, `IdleElastiCacheCluster`) implement `WastedResource` and carry the observed **facts** the decisions need: `LoadBalancer.registeredTargetCount`, `NatGateway.bytesOutLastWindow`, `EbsSnapshot.sourceVolumeExists` / `boundToAmiId`, `Ec2Instance.stoppedSince`, `IdleEbsVolume`'s summed `VolumeReadOps`/`VolumeWriteOps`, `UnderutilizedEc2Instance.maxCpuPercent`, `RdsUnderutilizedInstance.maxCpuPercent`, `LogGroup.hasRetentionPolicy()`, `OrphanedEni.isOrphaned()` (`Status === 'available'`), `S3Bucket.hasLifecyclePolicy()`, `UnderutilizedLambdaFunction.invocationsLastWindow`, `EfsFileSystem.numberOfMountTargets` / `ioBytesLastWindow`, `OverprovisionedDynamoDbTable.avgReadUtilizationPercent` / `avgWriteUtilizationPercent`, `IdleElastiCacheCluster.connectionsLastWindow`. `Gp2Volume`, `UnderutilizedEc2Instance`, `RdsUnderutilizedInstance`, `S3Bucket`, `UnderutilizedLambdaFunction` and `OverprovisionedDynamoDbTable` are savings opportunities rather than deletable waste: their `costEstimate` carries the estimated monthly *saving* (or, for the Lambda hygiene flag, a flat $0), not a cost being paid.

#### Waste Policies — where the business knowledge lives

The definition of "waste" does **not** live in the adapters or in the AWS API filters: it lives in the domain policies (`libs/cloud-cost/domain/src/policies/`). The base class `WastePolicy<T>` applies two cross-cutting rules:

- **Exclusion tag** (`cloudrift:ignore`, configurable): the resource is explicitly opted out by the user.
- **Grace period** (`minAgeDays`, default 7): a resource that is too young is not waste — a freshly detached volume, a just-created LB or a NAT with no traffic for a few hours are almost always work in progress, not waste.

Each concrete policy adds the type-specific criterion:

| Policy                    | Criterion                                 | False-positive guard                                                            |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `EbsVolumeWastePolicy`    | `state === 'available'`                   | grace on `createTime` (AWS does not expose the detach date)                     |
| `ElasticIpWastePolicy`    | no association                            | — (EIPs have no creation date)                                                  |
| `RdsInstanceWastePolicy`  | `status === 'stopped'`                    | — (AWS auto-restarts after 7 days: if it is stopped, it is recent by definition) |
| `LoadBalancerWastePolicy` | zero registered targets                   | grace on `createdTime`                                                          |
| `Ec2InstanceWastePolicy`  | `state === 'stopped'`                     | grace on `stoppedSince` (from `StateTransitionReason`), fallback `launchTime`   |
| `EbsSnapshotWastePolicy`  | source volume deleted                     | snapshots referenced by AMIs excluded (not deletable); grace on `startTime`     |
| `NatGatewayWastePolicy`   | zero outbound bytes in the window (48h)   | grace on `createTime` (freshly created environments)                            |
| `EbsIdlePolicy`           | attached (`in-use`) volume, total I/O ops ≤ `ebsIdleMaxOps` (default 0) over the window | grace on `createTime` (no I/O yet ≠ idle) |
| `Ec2UnderutilizedPolicy`  | running instance, max CPU% ≤ `ec2CpuPercent` (default 5) over the window | grace on `launchTime`; only registered when `--live-pricing` is on (needs a per-instance-type price) |
| `RdsUnderutilizedPolicy`  | available instance, max CPU% ≤ `rdsCpuPercent` (default 5) over the window | grace on `instanceCreateTime`; only registered when `--live-pricing` is on (needs a per-instance-class price) |
| `EbsGp2UpgradePolicy`     | in-use gp2 volume (savings, not waste)    | only `status=in-use` (unattached gp2 stays with `ebs-volume`); grace on `createTime` |
| `LogGroupWastePolicy`     | no retention policy configured            | grace on `creationTime`                                                          |
| `OrphanedEniWastePolicy`  | `Status === 'available'` (not attached)   | — (ENIs have no creation date); $0 cost — hygiene, not a saving                  |
| `S3NoLifecyclePolicy`     | no lifecycle configuration                | grace on `creationDate`; advisory saving (`estimated: true`)                     |
| `LambdaUnderutilizedPolicy` | invocations ≤ `lambdaInvocationsMin` (default 0) over the window | grace on `lastModified`; $0 cost — pay-per-use Lambda has no direct cost when idle |
| `EfsUnusedPolicy`         | no mount targets, or mounted with I/O ≤ `efsIoBytesMin` (default 0) over the window | grace on `creationTime`                                  |
| `DynamoDbOverprovisionedPolicy` | read **and** write utilization < `dynamoCapacityUtilizationPercent` (default 10%) over the window | grace on `creationDateTime`; advisory saving (`estimated: true`) |
| `ElastiCacheIdlePolicy`   | zero connections in the window            | grace on `createTime`; only registered when `--live-pricing` is on (needs a per-node-type price) |

`EbsIdlePolicy`, `Ec2UnderutilizedPolicy`, `RdsUnderutilizedPolicy`, `LambdaUnderutilizedPolicy`, `EfsUnusedPolicy` and `DynamoDbOverprovisionedPolicy` take their thresholds as constructor parameters (`ebsIdleMaxOps`, `ec2CpuPercent`, `rdsCpuPercent`, `lambdaInvocationsMin`, `efsIoBytesMin`, `dynamoCapacityUtilizationPercent`), configurable via `config.thresholds`. Policies are pure domain logic: tested without AWS, with their parameters coming from the CLI (`--min-age-days`, `--ignore-tag`) and the config file (`thresholds`).

#### Ports

- **Outbound `WasteScannerPort`** — the single detection port:
  ```typescript
  export interface WasteScannerPort {
    readonly kind: ResourceKind;
    scan(region: AwsRegion): Promise<Result<WastedResource[]>>;
  }
  ```
  The contract requires the scanner to return only resources **already confirmed** by the relevant policy.
- **Outbound `PricingPort`** — a single generic `getPrice(region: AwsRegion, key: string): number` (the same key used in `prices.json` and the config's `prices` overrides), plus `getPricesAsOf()` (the price-table verification date, shown in every report). Collapsed from 16 nominally-typed methods to this one: adding a fixed-cost resource type now only touches `prices.json`, never the port or its adapters ([ADR-0045](../adr/0045-pricingport-single-getprice-method.md)). A `prices` key in the config that doesn't match any known price-table key (typo, wrong region) produces a non-blocking warning instead of being silently ignored (`apps/cli/src/commands/pricing.factory.ts`, [ADR-0057](../adr/0057-unknown-config-price-keys-warning.md)).
- **Inbound `FindWastedResourcesUseCasePort`** — defines `WastedResourcesSummary { findings, totalWasteMonthlyUsd, totalOptimizationMonthlyUsd, scanErrors }` and `ResourceScanError { kind, region, error }`. The two totals are split by `FindingCategory` (see [above](#waste-vs-optimization--findingcategory)): only `totalWasteMonthlyUsd` feeds the CI gate.

### 3. `cloud-cost/application` — Generic use case and DTO

`AnalyzeCloudWasteUseCase` receives an **array of `WasteScannerPort`** and does not know how many or which ones:

```typescript
constructor(
  private readonly scanners: readonly WasteScannerPort[],
  private readonly scanConcurrency = 3,
) {}
```

It flattens every _(scanner, region)_ pair into a FIFO job queue consumed by a **worker pool with one global bound** (12 in-flight scans by default, any scanner/region mix — [ADR-0052](../adr/0052-global-scan-worker-pool.md), overridable via the `CLOUDRIFT_SCAN_CONCURRENCY` env var; the LocalStack e2e harness forces it down to 1, since LocalStack Community's single-process gateway can't reliably absorb that many concurrent connections — see [ADR-0063](../adr/0063-scan-concurrency-env-configurable-default-restored-to-12.md)); jobs are queued scanner-major so the first batch spreads across regions instead of concentrating on the first one. Errors are collected per _(scanner, region)_ pair: one region failing discards neither the results of the other regions nor those of the other scanners. The summary is always returned with partial data and the errors in `scanErrors`.

`toWasteReportDto()` projects the summary into **`WasteReportDto`**, a JSON-safe structure (primitives and ISO strings only): it is the data contract for any presentation, present and future (see [Frontend-readiness](#frontend-readiness)).

### 4. `cloud-cost/infrastructure/aws-adapter` — Concrete scanners

Every scanner implements `WasteScannerPort` with the **AWS SDK v3**: it creates the client for the region via `createAwsClientConfig()` (a factory building a fresh `NodeHttpHandler`/connection pool per call, so one scanner's `client.destroy()` can never affect another's in-flight connections — [ADR-0064](../adr/0064-per-client-requesthandler-not-shared.md); `maxAttempts: 3` for the SDK's built-in retry/backoff on throttling and transient errors, [ADR-0050](../adr/0050-aws-client-retry-backoff.md); a 5s connection / 30s request timeout, so a single hung socket can't stall a scan indefinitely, [ADR-0058](../adr/0058-aws-client-request-timeout.md)), uses `paginate()` to follow cursors (with an optional per-page `select` for the two scanners — snapshots, log groups — whose resource count is genuinely unbounded over time, filtering before accumulating instead of after, [ADR-0054](../adr/0054-paginate-select-per-page-streaming.md)), maps responses to entities (computing costs via `PricingPort`), applies the waste policy and destroys the client in the `finally`. SDK errors are wrapped in `AwsAdapterError`.

23 of the 43 scanners additionally fetch a CloudWatch metric per resource (and, for 12 of them, resolve a live per-type price). These extend the abstract `CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity>` template method (`scanners/cloudwatch-idle.scanner.ts`), which owns the client lifecycle, the concurrent metric fan-out and the `Result` wrapping — each concrete scanner implements only the resource-specific hooks (`listResources`, `fetchMetric`, `toEntity`, and optionally `resolvePrices`). See [ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md).

Required fields read off an AWS response (the resource's own primary identifier — `VolumeId`, `InstanceId`, …) are validated with a type-narrowing `.filter()` immediately after the fetch, not a non-null assertion: a malformed entry is excluded and logged (`DEBUG=cloudrift:*`) rather than silently propagating an `undefined` field into a finding. See [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md).

Adapters pre-filter server-side where possible (e.g. `status=available` for EBS) as an **optimization**: the API filter yields a superset of the candidates; the final decision always belongs to the domain policy.

Specifics:

- **`AwsNatGatewayScanner`**: CloudWatch calls are capped at 5 concurrent (`mapWithConcurrency`) to avoid throttling on accounts with many gateways.
- **`AwsEbsSnapshotScanner`**: also queries `DescribeImages` to exclude snapshots bound to registered AMIs.
- **`resolveAwsAccountId()`**: resolves the account ID via `sts:GetCallerIdentity`, removing manual input (the `--account-id` override remains).

### 5. `apps/cli` — Entry point and composition root

`analyze-waste.command.ts` orchestrates the run as a sequence of calls into two sibling modules ([ADR-0056](../adr/0056-analyze-waste-command-split.md)): `resolve-options.ts` (`resolveMinAgeDays`, `resolveExplicitScanners`, `resolveRegions`) resolves CLI options (regions, min-age, account ID) and loads the config file, and `post-analysis.ts` (`writeArtifacts`, `applyCostGate`) writes the file artifacts and applies the cost-gate threshold after the scan. The command itself delegates the actual instantiation of concrete implementations to `analyze-waste.composition.ts` through the injectable `AnalyzeDeps.createAnalysis` seam (the same seam `analyze-waste.command.spec.ts` fakes to test without AWS). Before that, it also resolves **which scanners to run**: `--all-services` or `--scanners <kinds...>` skip straight to a resolved list; otherwise, in a real terminal outside CI (and without `--silent`), an interactive `@clack/prompts` wizard (`apps/cli/src/wizard/scanner-selection.wizard.ts`, see [ADR-0041](../adr/0041-interactive-scanner-selection-wizard.md)) lets the user pick — every kind pre-checked, so Enter alone still scans everything; non-TTY/CI/`--silent` skip the wizard and run every scanner, unchanged from before this feature.

`analyze-waste.composition.ts` calls into `scanner-registry.ts`, the declarative registry where concrete scanner implementations are instantiated — not a hand-written list. `ALWAYS_ON_SCANNERS` (`always-on-scanners.ts`, 30 entries) and `LIVE_PRICING_SCANNERS` (`live-pricing-scanners.ts`, 13 entries) are each an array of `{ kind, create(ctx) }` entries, split across the two files on that same always-on/live-pricing seam ([ADR-0077](../adr/0077-scanner-registry-split-on-pricing-seam.md)); `scanner-registry.ts` itself only re-exports both arrays plus the shared types and `buildScanners()`. `buildScanners()` is a `map`/`filter` over both arrays (the second only when a live-pricing adapter is available), then filtered again in `analyze-waste.composition.ts` down to the resolved scanner selection (`AnalysisContext.scannerKinds`, undefined = no filter). `assertRegistryMatchesResourceKinds()` runs at module load and throws if any `ResourceKind` is missing from, or duplicated across, the two registries — a wiring mistake fails at startup, not silently at scan time. See [ADR-0043](../adr/0043-declarative-scanner-registry.md). The `LIVE_PRICING_SCANNERS` entries (`AwsEc2UnderutilizedScanner`, `AwsRdsUnderutilizedScanner`, `AwsElastiCacheIdleScanner` and the Redshift/OpenSearch/MSK/DocumentDB/Neptune/MQ/WorkSpaces equivalents) are only built when `--live-pricing` is set: their cost estimate needs a per-instance-type/class/node-type price that the static table doesn't carry (too many distinct types to maintain), so without live pricing there is nothing reliable to report and the scanners are left out rather than registered with a zero estimate.

Running `cloudrift` with no subcommand at all, in a real terminal, skips Commander entirely and hands off to `runEntryWizard()` (`apps/cli/src/wizard/entry.wizard.ts`) — a mode picker (waste / cost / trend) that gathers the same options as an equivalent flag-driven invocation and then calls `analyzeWasteCommand`/`costCommand`/`trendCommand` directly, so the wizard is purely an input-gathering layer with no duplicated business logic. Any explicit subcommand or flag, CI, or non-interactive stdout bypasses the wizard unchanged. See [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md).

Back in `analyze-waste.command.ts`, the result is handed to the formatters. The four formatters (console table, PDF, JSON, Markdown) share the `resource-presenters.ts` registry, typed `Record<ResourceKind, ResourcePresenter<…>>`: forgetting the presenter for a new kind is a compile error. Table, PDF and Markdown all dispatch per finding through `rowFor`/`recommendFor` — an exhaustive `switch` on the finding's own `kind`, not a `presenterFor(kind)` call paired with a separately-obtained finding — so there is no (kind, finding) pair a future edit could decouple; a missing case fails the build ([ADR-0059](../adr/0059-presenter-dispatch-exhaustive-switch.md)). The output format is selected by `--format` (`table` | `json` | `markdown`); `markdown` targets CI / PR comments.

---

## Cost analytics: `cost` / `trend`

Alongside waste detection, the CLI has a second, sibling capability built the same hexagonal way: comparing and trending actual AWS spend via Cost Explorer ([ADR-0069](../adr/0069-cost-explorer-integration-billed-api-confirmation.md)). It shares `shared/kernel` but is not an extension of `WastedResource` — a spend comparison has no entity, no waste policy, just aggregate numbers from one external API, so forcing it through the waste model would mean fake entities with no basis in the ubiquitous language.

```
CostComparisonSummary / CostTrendSummary   (cloud-cost/domain)
        ▲ produced by
CompareCostUseCase / CostTrendUseCase      (cloud-cost/application)
        │ depends on
CostExplorerPort                           (cloud-cost/domain, outbound)
        ▲ implemented by
AwsCostExplorerAdapter                     (infrastructure/aws-adapter)
        ▲ wrapped by (decorator)
CachedCostExplorerAdapter                  (infrastructure/aws-adapter)
```

- **`CostExplorerPort`** — a single `getCostAndUsage({ startDate, endDate, granularity })` outbound port, mirroring `WasteScannerPort`'s minimalism. `AwsCostExplorerAdapter` implements it against `@aws-sdk/client-cost-explorer`; unlike every other adapter, it is never parameterized by region — Cost Explorer is a single global endpoint (`us-east-1` fixed).
- **Billed, unlike everything else.** Every scanner and `analyze` call only free describe/list APIs; Cost Explorer bills $0.01/request. `cost.command.ts`/`trend.command.ts` both call `confirmCostExplorerCharge()` before touching the port, so the confirmation protects direct CLI/script usage identically to the wizard's path — see [ADR-0069](../adr/0069-cost-explorer-integration-billed-api-confirmation.md).
- **`CachedCostExplorerAdapter`** — a decorator (not a modification of the adapter) that caches a query's response on disk, keyed by its exact parameters, but only once the whole requested range is more than 2 days in the past (AWS's own reconciliation lag for recent data). Composed by default in `cost-analytics.composition.ts`; `--refresh-cache` bypasses it. See [ADR-0070](../adr/0070-cost-explorer-disk-cache-decorator.md).
- **`CompareCostUseCase`** — current spend (1st of the month through today) vs. the identical day-of-month range last month, so an early-month run doesn't look like a false saving from an unequal day count.
- **`CostTrendUseCase`** — `MONTHLY`-granularity spend over the last N months, optionally filtered to specific services.
- **`cost-analytics.composition.ts`** mirrors `analyze-waste.composition.ts`'s `AnalyzeDeps` seam (`CostAnalyticsDeps`), so `cost.command.spec.ts`/`trend.command.spec.ts` inject a fake `CostExplorerPort` and never touch AWS — or real money — in tests.

---

## Dead resources: `dead-resources`

The CLI's third capability, and the first one that isn't cost-shaped at all: hygiene findings — things left dead or unused in the account with **no direct AWS cost** — unused EC2 key pairs, EC2 Reserved Instances expiring soon, inactive IAM users, unattached IAM policies ([ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md)). `WastedResource.costEstimate` is non-optional, so forcing a $0-only domain through it would mean every finding fakes a dollar figure and every report prints a misleading `$0.00/mo` — this domain instead has its own inbound-boundary type, `DeadResource`, with `severity` (`info`/`warning`/`critical`) where `WastedResource` has `costEstimate`.

```
DeadResource                             (dead-resources/domain)
        ▲ implemented by
Ec2KeyPairUnused / Ec2RiExpiringSoon /
IamUserInactive / IamPolicyUnattached    (dead-resources/domain, entities)
        ▲ produced by
DeadResourceScannerPort                  (dead-resources/domain, outbound)
        ▲ implemented by
AwsEc2KeyPairUnusedScanner / ...         (infrastructure/aws-adapter)
        ▲ orchestrated by
FindDeadResourcesUseCase                 (dead-resources/application)
```

- **A genuinely separate bounded context**, not a submodule of `cloud-cost` — see [Bounded Context](#bounded-context) below. `dead-resources-domain`'s only dependency on `cloud-cost-domain` is re-exporting `AwsRegion` (a generic, cost-agnostic AWS value object) to avoid two region-code lists drifting apart — a documented, deliberate exception, not a general coupling.
- **`DeadResourceScannerPort`** mirrors `WasteScannerPort`'s single-method minimalism (`kind`, `scan(region)`), plus an optional `scope?: 'regional' | 'global'` (default `'regional'`) that `WasteScannerPort` doesn't need — see the global-scope note below.
- **`DeadResourcePolicy<T>`** mirrors `WastePolicy<T>`'s `ignoreTag`/`excludeTagValues`/grace-period machinery, but as its own class hierarchy (ADR-0078) — not a shared base, to keep the two domains decoupled. Two of the four policies (`Ec2RiExpiringSoonPolicy`, and effectively the threshold shape of `IamUserInactivePolicy`) take their own kind-specific threshold beyond the shared options, same pattern as e.g. `EbsIdlePolicy`'s extra `maxOps` param in the cost-waste domain.
- **Global-scope scanners.** IAM is a global AWS service; unlike every cost-waste scanner (and the two regional kinds here), `AwsIamUserInactiveScanner`/`AwsIamPolicyUnattachedScanner` set `scope: 'global'`. `FindDeadResourcesUseCase` gives a `'global'` scanner exactly one job regardless of how many regions were requested — calling it once per region would return the same IAM users/policies N times and multiply billed-nothing-but-still-wasteful API calls. See [ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md) for the alternatives considered.
- **`dead-resources.composition.ts`** mirrors `analyze-waste.composition.ts`'s shape at a fraction of the size: `buildScanners()` is a plain 18-entry array (not split into files the way [ADR-0077](../adr/0077-scanner-registry-split-on-pricing-seam.md) split the 43-entry cost-waste registry — 18 still doesn't warrant it), and `scannerKinds` filtering (from `--scanners` or the wizard's multiselect) works the same way `AnalysisContext.scannerKinds` does.

---

## Error handling

The project uses `Result<T, E>` for expected errors, **with no exceptions across layer boundaries** — including user input: `AwsRegion.parse()` returns `Result<AwsRegion, InvalidAwsRegionError>` and the CLI handles it by printing a clean message and exiting with code 1 (a throwing `AwsRegion.create()` also exists, reserved for codes known at compile time, e.g. test fixtures).

```
AWS scanner ──Result.ok(findings)───▶ Use Case ──Result.ok(summary)──▶ CLI
            ──Result.fail(err)──────▶ Use Case ──scanErrors[{kind, region, error}]──▶ CLI (warning)
```

Error granularity is **per (scanner, region)**: a missing permission in one region produces a warning for that pair and touches nothing else.

---

## Towards multi-cloud

Today the product's domain **is** AWS waste: `EbsVolume`, `NatGateway` and `ElasticIp` are legitimately part of the ubiquitous language, and pretending otherwise would produce empty abstractions. That said, the refactoring towards `WastedResource` has made the multi-cloud path concrete and incremental. Here is how it would happen, in three phases:

### Phase 1 — Generalize the inbound boundary (small)

The only AWS-specific type crossing the inbound boundary is `AwsRegion`. Introduce a `CloudLocation { provider: 'aws' | 'gcp' | 'azure'; code: string }` VO (or add `provider` to `WastedResource`), and `ResourceScanError.region` becomes a qualified string. Coordinator, summary, DTO and formatters **do not change**: they already depend only on `WastedResource`.

### Phase 2 — New bounded context or new kinds (the real decision)

Two options, to be chosen when the real requirement exists:

- **Additional kinds in the same context** — `'gcp-persistent-disk'`, `'gcp-static-ip'`, … join the `ResourceKind` union with their own entities (`PersistentDisk`, not a fake `EbsVolume`), policies and scanners (`libs/cloud-cost/infrastructure/gcp-adapter`). The right fit if the product remains "one unified waste report". The coordinator's `Promise.all` scales from 18 to N scanners without changes.
- **Separate bounded context** — `libs/gcp-cost/` with its own domain, if the semantics diverge too much. Shares only `shared/kernel`. The `libs/<context>/` structure already allows it.

The first option is the recommended one as long as the report stays unified: the marginal cost of a GCP kind is identical to that of an AWS kind (entity + policy + scanner + presenter).

### Phase 3 — Multi-provider composition root

The CLI registers both providers' scanners in the same array:

```typescript
const scanners: WasteScannerPort[] = [
  ...buildAwsScanners(awsPricing, awsAccountId, policyOptions),
  ...buildGcpScanners(gcpPricing, gcpProjectId, policyOptions),
];
```

The use case, the summary, the DTO and the formatters stay untouched — this is the property the current architecture actually guarantees, and it is verifiable: none of those files mentions an AWS service.

**What NOT to promise:** that "you just write an adapter". You need GCP entities, GCP policies (waste semantics differ: a Persistent Disk has no EBS-style `available` state), a GCP price table and the presenters. The architecture guarantees the _core_ stays untouched, not that the work is free.

---

## Frontend-readiness

Today the presentations are the terminal and PDF; tomorrow there could be a web frontend. The design accounts for it like this:

```
                        ┌────────────► table-formatter ──► terminal
WastedResourcesSummary ─┼────────────► pdf-formatter ────► report.pdf
  (domain entities)     │
                        └─ toWasteReportDto() ─► WasteReportDto (JSON-safe)
                                                   │
                                                   ├─► json-formatter ──► stdout / file (--json)
                                                   └─► [future] HTTP adapter ──► frontend SPA
```

The points that make a frontend an addition rather than a refactoring:

1. **`WasteReportDto` is the API contract that already exists.** It is serializable (no classes, no `Date`, ISO strings only), versionable and already exercised in production by the `--json` flag. An HTTP endpoint (`GET /api/waste-report`) would return exactly this DTO: the frontend would never depend on domain entities.
2. **The use case is already headless.** `AnalyzeCloudWasteUseCase` does not know it lives inside a CLI: a new entry point (`apps/api` with Fastify/Hono, or a Lambda) is just another composition root that instantiates the same scanners and calls the same `execute()`.
3. **No logic in the formatters.** Table, PDF and JSON are pure projections of the summary/DTO; the frontend would be the fourth projection, built on the DTO's `breakdown`, `findings` and `scanErrors` (which already contain labels, reasons and costs ready for rendering).

Concrete steps when needed: create `apps/api` (new Nx project) with an endpoint that runs the use case and returns the DTO; add authentication/caching in the HTTP adapter (not in the core); the frontend (React/Vue in `apps/web`) consumes the typed DTO by importing `WasteReportDto` from `cloud-cost-application` — the type is already exported.

---

## Bounded Context

There are two bounded contexts today: **cloud-cost** (waste detection + cost analytics) and **dead-resources** (hygiene findings, [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)) — the `libs/<context>/{domain,application,infrastructure}` structure this repo already used for the first context extended cleanly to the second, no changes needed to the pattern itself. They share only `shared/kernel`, with one documented exception: `dead-resources-domain` re-exports `cloud-cost-domain`'s `AwsRegion` rather than duplicating the region-code list. Nx's `depConstraints` ([ADR-0075](../adr/0075-nx-dep-constraints-layer-enforcement.md)) enforce *layer* isolation (domain/application/infrastructure) but not *context* isolation — nothing stops a future context from importing another context's internals beyond this one deliberate case; it holds by convention and code review, not by a lint rule. Adding a third context (e.g. `gcp-cost`, or `security-posture`) follows the same shape.
