# cloud-cost-domain

The domain layer for the cloud-cost bounded context. Contains entities, value objects, waste policies and port interfaces. Has no runtime dependencies outside `shared-kernel` — no AWS SDK, no I/O.

## `WastedResource` and `ResourceKind`

`WastedResource` is the single interface every entity implements — it's the only type that crosses the inbound boundary (coordinator, summary, CLI formatters depend on it, never on the concrete entities):

```typescript
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

`ResourceKind` is a union of 10 string literals (`wasted-resource.ts`). Each kind has metadata in `RESOURCE_KIND_META`: a `label`, a `category` (`'waste'` | `'optimization'`) and an `estimated` flag. `waste` is money being spent now (feeds `totalWasteMonthlyUsd` and the CI gate); `optimization` is a saving that keeps the resource (gp2→gp3, EC2 rightsizing), shown separately and never gated. `estimated: true` marks a heuristic figure that needs verification before acting.

## Entities

### `EbsVolume` (`ebs-volume`, waste)

Unattached EBS volume. `isUnattached()` is `true` when `state === 'available'`. Cost is `sizeGb × pricePerGB` for the volume type.

### `IdleEbsVolume` (`ebs-idle`, waste)

An **attached** (`in-use`) volume with little to no I/O over the observed window — distinct from `EbsVolume`, which only covers unattached ones, so the same volume is never double-counted. `totalOps()` sums `readOps + writeOps`; the policy compares it against a configurable threshold (`thresholds.ebsIdleMaxOps`, default 0).

### `ElasticIp` (`elastic-ip`, waste)

Unassociated Elastic IP. `isUnassociated()` is `true` when there is no `associationId`. Fixed cost: $3.60/month (AWS's $0.005/hr for unassociated EIPs).

### `RdsInstance` (`rds-instance`, waste)

Stopped RDS DB instance. `isStopped()` checks `dbInstanceStatus === 'stopped'`. Cost is storage-only (AWS waives instance hours for up to 7 days while stopped, then auto-restarts — which is also why this policy applies no grace period).

### `LoadBalancer` (`load-balancer`, waste)

Idle ALB/NLB/GWLB. `isIdle()` is `true` when `registeredTargetCount === 0` (more precise than "target groups exist": a group can be empty). Fixed base cost (~$16.20/month).

### `Ec2Instance` (`ec2-instance`, waste)

Stopped EC2 instance. `isStopped()` checks `state === 'stopped'`. `stoppedSince` (reconstructed from `StateTransitionReason` by the scanner) lets the policy apply the grace period to the actual stop time rather than launch time. Cost is the sum of `attachedVolumes` — the instance itself is free while stopped, but its EBS volumes keep billing.

### `EbsSnapshot` (`ebs-snapshot`, waste)

Orphan snapshot. `isOrphan()` is `true` when `sourceVolumeExists` is `false`. `boundToAmiId`, if set, means the snapshot is referenced by a registered AMI and therefore not deletable regardless of orphan status — the policy excludes it.

### `NatGateway` (`nat-gateway`, waste)

Idle NAT Gateway. `isIdle()` is `true` when `bytesOutLastWindow === 0` over `metricWindowHours` (default 48h, configurable via `config.cloudwatchWindowHours`). Fixed base cost (~$32.40/month).

### `Gp2Volume` (`ebs-gp2-upgrade`, optimization)

An **in-use** gp2 volume upgradeable to gp3 at the same baseline performance for less money. Not waste — the resource stays. `costEstimate` (and `monthlySavingUsd`) carry the monthly *saving*, not a cost being paid. Unattached gp2 volumes are reported once, as `ebs-volume`, never here too.

### `UnderutilizedEc2Instance` (`ec2-underutilized`, optimization, estimated)

A **running** instance whose `maxCpuPercent` stayed below a threshold (`thresholds.ec2CpuPercent`, default 5) over `windowDays` (14 by default) — a rightsizing candidate. Advisory only: low CPU doesn't prove RAM/network are equally idle. `costEstimate` carries an estimated saving (half the instance's monthly cost, a one-tier-downsize heuristic), which is why `estimated: true` in its `RESOURCE_KIND_META` entry.

## Waste Policies

`WastePolicy<T>` (`policies/waste-policy.ts`) is the abstract base every concrete policy extends. `evaluate(resource, now)` first applies two cross-cutting rules for free, then delegates to the subclass's `judge()`:

- **Exclusion tag** (`ignoreTag`, default `cloudrift:ignore`) — explicit opt-out.
- **`excludeTagValues`** — exact `key: value` tag matches (e.g. never touch `Environment: Production`).

Concrete policies (`policies/resource-waste-policies.ts`): `EbsVolumeWastePolicy`, `ElasticIpWastePolicy`, `RdsInstanceWastePolicy`, `LoadBalancerWastePolicy`, `Ec2InstanceWastePolicy`, `EbsSnapshotWastePolicy`, `NatGatewayWastePolicy`, `EbsIdlePolicy`, `Ec2UnderutilizedPolicy`, `Gp2UpgradePolicy`. Most also apply a grace period (`isWithinGracePeriod`, `minAgeDays`, default 7) on top of the type-specific criterion; `EbsIdlePolicy` and `Ec2UnderutilizedPolicy` additionally take a numeric threshold as a constructor parameter (`maxOps`, `maxCpuPercent`).

## Value Objects

### `AwsRegion`

Wraps a validated AWS region code. `AwsRegion.parse(code)` returns `Result<AwsRegion, InvalidAwsRegionError>` — the path for external input (CLI `-r`, config). `AwsRegion.create(code)` throws and is reserved for codes known at compile time (tests/fixtures).

### `CostEstimate`

Monthly cost (or saving) in USD with a human-readable description. Single factory: `CostEstimate.of(monthlyCostUsd, description)`. `format()` returns `"$X.XX/mo"`.

## Ports

### Inbound

- **`FindWastedResourcesUseCasePort`** — `execute({ regions }) → Result<WastedResourcesSummary>`, where `WastedResourcesSummary` is `{ findings, totalWasteMonthlyUsd, totalOptimizationMonthlyUsd, scanErrors }`. Implemented by `AnalyzeCloudWasteUseCase` in `cloud-cost-application`.

### Outbound

- **`WasteScannerPort`** — the single detection port: `{ kind: ResourceKind; scan(region): Promise<Result<WastedResource[]>> }`. Every resource type is a plugin implementing this one interface (there is no per-resource repository port). The contract requires the scanner to return only candidates already confirmed by the relevant waste policy.
- **`PricingPort`** — per-region, per-type price getters (`getEbsVolumePricePerGbMonth`, `getElasticIpPricePerMonth`, …) plus `getPricesAsOf()`. Implemented in `cloud-cost-infrastructure-aws-adapter`. Per-instance-type EC2 pricing (used by `ec2-underutilized`) is resolved separately, on demand, and isn't part of this port.

## Building

```sh
pnpm nx build cloud-cost-domain
```

## Testing

```sh
pnpm nx test cloud-cost-domain
```
