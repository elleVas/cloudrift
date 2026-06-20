# How the code works

> 🇮🇹 [Versione italiana](../it/funzionamento.md)

This document describes the full execution flow, from CLI invocation to the AWS responses and the rendering of results.

---

## End-to-end execution flow

```
user: cloudrift analyze -r us-east-1 eu-west-1 [--format json|markdown] [--pdf] [--live-pricing]
          │
          ▼
     apps/cli/src/main.ts
     Commander.js parses the arguments
          │
          ▼
     analyze-waste.command.ts  (composition root)
     1. loadConfig() — cloudrift.config.json / .cloudriftrc / --config
     2. AwsRegion.parse() per region; config.excludeRegions filtered out
     3. accountId: --account-id or STS GetCallerIdentity
     4. Pricing: static table ← live API (--live-pricing) ← config.prices (wins)
     5. Instantiates policies (config + flags) and 9 of the 10 scanners
        (the 10th, EC2 underutilized, only with --live-pricing)
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Runs the registered scanners in parallel (Promise.all),
     each scanner iterates the regions sequentially
          │
     ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    │ (one per ResourceKind)
   EBS  EIP  RDS  ELB  EC2  Snap  NAT  gp2  EBS  EC2  │
  scan  scan scan scan scan scan scan scan  idle under-│
     │    │    │    │    │    │    │    │   scan util* │
     ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼
  EC2  EC2  RDS ELBv2 EC2* EC2** EC2+CW EC2 EC2+CW EC2+CW
  API  API  API  API  API  API   API   API  API   +Pricing
          │        (* 2 calls; ** 3 calls; CW=CloudWatch, max 5 concurrent)
          │        (EC2 underutilized: registered only with --live-pricing —
          │         needs a per-instance-type price the static table lacks)
          ▼
     Each scanner applies the domain waste policy
     (grace period, exclusion tag, type-specific criteria)
          │
          ▼
     WastedResourcesSummary { findings: WastedResource[],
                              totalWasteMonthlyUsd,
                              totalOptimizationMonthlyUsd, scanErrors }
          │
          ▼
     --format selects stdout: table (default) | json | markdown
     --pdf / --json [file] also write artifacts to disk
     totalWasteMonthlyUsd > config.costAlertThresholdUsd → exit code 2 (CI gate)
     (totalOptimizationMonthlyUsd, being estimated/advisory, never gates CI)
```

---

## Component by component

### `main.ts` — Entry point

```typescript
program
  .command('analyze')
  .option('-r, --regions <regions...>', 'AWS regions to scan', ['us-east-1'])
  .option('--account-id <id>', 'AWS account ID override (auto-detected via STS when omitted)')
  .option('--min-age-days <days>', 'grace period …', '7')
  .option('--ignore-tag <tag>', 'resources carrying this tag are excluded …', 'cloudrift:ignore')
  .option('--pdf [filename]', 'Export a PDF report …')
  .option('--json [filename]', 'Output the report as JSON …')
  .action(analyzeWasteCommand);
```

`--pdf` and `--json` accept an optional filename. `--json` with no filename prints **only** the JSON to stdout (the table output is suppressed), making the command composable: `cloudrift analyze --json | jq '.totalWasteMonthlyUsd'`.

---

### `analyze-waste.command.ts` — Composition root

The only place where concrete implementations are instantiated and injected:

```typescript
const regions: AwsRegion[] = [];
for (const code of options.regions) {
  const parsed = AwsRegion.parse(code);          // Result, no throw on user input
  if (!parsed.ok) return fail(parsed.error.message);
  regions.push(parsed.value);
}

const accountId = options.accountId ?? (await resolveAwsAccountId()) ?? 'unknown';

const pricing = new StaticPriceTableAdapter();
const policyOptions = { minAgeDays, ignoreTag: options.ignoreTag };

const scanners: WasteScannerPort[] = [
  new AwsEbsVolumeScanner(pricing, accountId, new EbsVolumeWastePolicy(policyOptions)),
  new AwsElasticIpScanner(pricing, accountId, new ElasticIpWastePolicy(policyOptions)),
  // … the other 6 always-registered scanners (rds, lb, ec2, snapshot, nat, gp2-upgrade, ebs-idle)
];

// EC2 underutilized needs a per-instance-type price (only available live):
// registered conditionally, not part of the base 9.
if (livePricingAdapter) {
  scanners.push(new AwsEc2UnderutilizedScanner(livePricingAdapter, accountId, new Ec2UnderutilizedPolicy(policyOptions)));
}

const useCase = new AnalyzeCloudWasteUseCase(scanners);
const result = await useCase.execute({ regions });
```

The account ID is resolved via `sts:GetCallerIdentity` with the same credentials as the scan; `--account-id` remains as an override and `'unknown'` is the fallback when STS is unreachable.

---

### `AnalyzeCloudWasteUseCase` — Generic coordinator

```typescript
await Promise.all(
  this.scanners.map(async (scanner) => {
    for (const region of request.regions) {        // sequential per region
      const result = await scanner.scan(region);
      if (result.ok) findings.push(...result.value);
      else scanErrors.push({ kind: scanner.kind, region: region.code, error: result.error });
    }
  }),
);
```

Three properties worth noting:

1. **Generic**: the coordinator does not know the resource types; adding a scanner does not modify it.
2. **Error granularity per (scanner, region)**: if `eu-west-1` is not enabled, the `us-east-1` results for the same resource type survive, and the error reports both the kind and the region.
3. **Concurrency profile**: parallel across resource types (different APIs), sequential across regions of the same type (same API in different regions) — to respect AWS rate limits.

The total cost is the sum of the findings' `costEstimate`s; failed types simply do not contribute (and the report flags the incompleteness).

---

### The scanners (e.g. `AwsEbsVolumeScanner`)

Every scanner implements `WasteScannerPort` and follows the same scheme:

1. Creates the AWS client for the region.
2. Collects the **candidates** with `paginate()` (AWS APIs return max 1000 items per page), pre-filtering server-side where possible (`status=available`, `state-name=stopped`, …). The pre-filter is an optimization: it yields a superset.
3. Maps the responses to domain entities, computing the cost via `PricingPort` and setting `accountId` and `detectedAt`.
4. **Applies the domain waste policy** — this is where grace period, exclusion tag and type-specific criteria decide what is really waste.
5. Wraps SDK errors in `AwsAdapterError` and destroys the client in the `finally`.

```typescript
const volumes = rawVolumes
  .map((v) => new EbsVolume({ /* AWS fields → entity mapping */ }))
  .filter((volume) => this.policy.evaluate(volume, now).isWaste);
```

#### `AwsEc2InstanceScanner` — Two calls + stop date

`DescribeInstances` does not report volume sizes: a second `DescribeVolumes` call resolves sizes and types (skipped when there are no stopped instances). The stop date is reconstructed from `StateTransitionReason` (the string `"User initiated (2026-06-01 12:34:56 GMT)"`): this is what lets the policy apply the grace period to the actual stop time rather than the launch time.

#### `AwsEbsSnapshotScanner` — Three sources in parallel

```
DescribeSnapshots(OwnerIds: self)  ┐
DescribeVolumes()                  ├─ Promise.all
DescribeImages(Owners: self)       ┘
```

Set of existing volumes → `sourceVolumeExists`; snapshot→AMI map from the images' `BlockDeviceMappings` → `boundToAmiId`. The policy excludes snapshots whose volume still exists, those referenced by AMIs (not deletable) and recent ones.

#### `AwsNatGatewayScanner` — EC2 + CloudWatch with capped concurrency

For each `available` gateway, it queries `GetMetricStatistics(BytesOutToDestination, 48h, Sum)`. CloudWatch calls go through `mapWithConcurrency(…, 5, …)`: on an account with 100 NATs there are at most 5 calls in flight, avoiding throttling. The observed bytes end up in the entity (`bytesOutLastWindow`), and the "idle" decision belongs to the policy.

#### `AwsLoadBalancerScanner` — Target counting

For each ALB/NLB it counts the registered targets via `DescribeTargetGroups` + `DescribeTargetHealth` (more precise than just "target groups exist": a TG can be empty). The count ends up in the entity (`registeredTargetCount`); the policy decides.

#### `AwsEbsIdleScanner` — Attached but no I/O

Distinct from `AwsEbsVolumeScanner` (unattached volumes): this one lists `in-use` volumes and sums `VolumeReadOps` + `VolumeWriteOps` from CloudWatch over the window (48h default), through the same `mapWithConcurrency(…, 5, …)` cap as the NAT scanner. A volume with zero total ops is "idle" — paid storage attached to an instance that never touches the disk. `EbsIdlePolicy`'s threshold (`maxOps`, default 0) is configurable via `config.thresholds.ebsIdleMaxOps`.

#### `AwsEc2UnderutilizedScanner` — CPU-based rightsizing, advisory only

Lists `running` instances, fetches `CPUUtilization` (`Average`, `Maximum`) over a configurable window (`config.utilizationWindowHours`, default 168h = 7 days, max 336h = 14 days), and resolves the instance's monthly price **on demand** from the AWS Pricing API (it implements `Ec2InstancePricingSource` by duck typing against `AwsPricingApiAdapter`) — the per-instance-type price space is too large for the static table. Without `--live-pricing` there is no price to resolve, so the composition root does not register this scanner at all (see the composition root section above). The savings estimate is half the instance's monthly cost (`RIGHTSIZE_SAVING_FRACTION = 0.5`, a one-tier-downsize heuristic) and is marked `estimated: true` in `RESOURCE_KIND_META`: low CPU alone doesn't confirm RAM/network are equally idle.

#### `AwsRdsUnderutilizedScanner` — CPU-based rightsizing, advisory only

Same pattern as `AwsEc2UnderutilizedScanner`, applied to RDS. Lists `available` instances (server-side filter, disjoint from `AwsRdsInstanceScanner`, which filters on `stopped`), fetches `CPUUtilization` from the `AWS/RDS` namespace (`Average`, `Maximum`) over the same configurable window (`config.utilizationWindowHours`), and resolves the monthly price **on demand** from the AWS Pricing API (it implements `RdsInstancePricingSource` by duck typing against `AwsPricingApiAdapter`, which maps the `DescribeDBInstances` engine — e.g. `postgres` — to the Pricing API's `databaseEngine` value — `PostgreSQL` — and uses `deploymentOption` for Single-AZ/Multi-AZ; engines with no mapping, such as Aurora, resolve to `undefined`). Without `--live-pricing` the scanner isn't registered, for the same reason as the EC2 scanner. Same savings estimate (half the monthly cost, `RIGHTSIZE_SAVING_FRACTION = 0.5`) and the same `estimated: true` flag: low CPU alone doesn't confirm storage I/O or connections are equally idle.

---

### Entities and Value Objects

All entities implement `WastedResource` and freeze their props (`Object.freeze`). Besides the common fields (`accountId`, `detectedAt`, `tags`, `monthlyCostUsd`), every entity carries the facts its policy needs:

```typescript
// Examples of decision "facts"
LoadBalancer.registeredTargetCount         // → isIdle()
NatGateway.bytesOutLastWindow              // → isIdle()
EbsSnapshot.sourceVolumeExists             // → isOrphan()
EbsSnapshot.boundToAmiId                   // → not deletable
Ec2Instance.stoppedSince                   // → grace period on the actual stop
IdleEbsVolume.totalOps()                   // readOps + writeOps → EbsIdlePolicy
UnderutilizedEc2Instance.maxCpuPercent     // → Ec2UnderutilizedPolicy
```

`CostEstimate.of(monthlyCostUsd, description)` is the only factory: price computation lives in the infrastructure (`StaticPriceTableAdapter` + `prices.json`), never in the domain.

---

### Formatters

The three formatters share the `resource-presenters.ts` registry (CLI):

```typescript
type PresenterMap = { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> };

export const presenters: PresenterMap = {
  'ebs-volume': { title, head, colWidths, row(v), recommend(v) },
  // … the mapped type forces exhaustiveness: a missing key is a compile error
};
```

- **Console table** (`waste-report.table-formatter.ts`): iterates `RESOURCE_KINDS`, uses `groupByKind(findings)` and the presenter for headers and rows. At the end: warnings per (kind, region), the waste total, a separate "Optimization opportunities" line when `totalOptimizationMonthlyUsd > 0`, and a disclaimer with the price table date.
- **PDF** (`waste-report.pdf-formatter.ts`): executive summary page (totals, breakdown, top 8 recommendations from `presenter.recommend`) + one page per kind. The optimization total is called out separately, with a note that `estimated` items need verification. `drawTable` handles **page breaks**: when a table exceeds the bottom margin, it closes the border, opens a new page and redraws the header.
- **JSON** (`waste-report.json-formatter.ts`): serializes `toWasteReportDto(summary, meta)` — the data contract for dashboards, CI or a future frontend. Every finding carries its `category` and `estimated` flag.
- **Markdown** (`waste-report.markdown-formatter.ts`): a Pull-Request-ready report (totals, breakdown, collapsible `<details>` per kind, top recommendations, cost-threshold callout, a separate "Total optimization" row) for `--format markdown` in CI.

`--format` (`table` | `json` | `markdown`) selects what goes to stdout; `--pdf` / `--json [filename]` write additional files. In machine-readable formats the human chrome is routed to stderr so stdout carries only the report.

---

## Pricing resolution

Costs are resolved per `(region, priceKey)` from three layers built in the composition root, most specific winning:

```
prices.json (static, always present)
   ← AWS Pricing API (only with --live-pricing)
   ← config.prices (user overrides, win)
```

All three share one `PriceTable` shape (`region → { key: USD }` with a `default` fallback), so they compose with a plain `mergePriceTables`. Because the merge happens **before** the scan, the `PricingPort` getters stay synchronous and the scanners are unchanged.

- **`AwsPricingApiAdapter.warmUp(regions)`** fetches list prices (`@aws-sdk/client-pricing`) and materialises a table. It accepts a price **only when the filters resolve to a single value** (ambiguous → omitted → static fills it); any failure makes the caller fall back entirely to the static table with a warning — never a crash.
- **`config.prices`** are the user's negotiated/enterprise rates and win over both. They are the only way to make the report match the actual bill — even live prices are AWS *list* prices, not your invoice.
- `getPricesAsOf()` reflects the layer used: the static date, the live fetch date, or `… + custom overrides`.

**Exception: `AwsEc2UnderutilizedScanner`.** Per-instance-type prices aren't in `prices.json` (too many instance types to maintain) and aren't pre-warmed by `warmUp()`. The scanner instead calls `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)` directly, on demand, for each distinct instance type found — which is why this one scanner needs `--live-pricing` to even be registered, rather than degrading gracefully to a static fallback like the others.

## CI/CD integration

Three pieces make the tool pipeline-native:

1. **`--format markdown`** renders a Pull-Request-ready report (totals, breakdown, top recommendations, threshold callout) — pipe it to `$GITHUB_STEP_SUMMARY` or post it as a PR comment.
2. **`config.costAlertThresholdUsd`** sets a budget: when `totalWasteMonthlyUsd` exceeds it the command sets **exit code 2**, which fails the CI job. `totalOptimizationMonthlyUsd` never gates CI — it's an estimated/advisory figure. The alert goes to stderr so it never corrupts machine-readable stdout.
3. **Clean stdout** — in `json`/`markdown` formats all human messages are routed to stderr, so `cloudrift … --format json | jq` and `… --format markdown >> "$GITHUB_STEP_SUMMARY"` are safe.

The config file (`cloudrift.config.json`) is discovered from the working directory, so committing it at the repo root means CI picks it up automatically after checkout.

---

## How AWS credentials are handled

The AWS SDK v3 uses the **default credential chain**:

1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. `~/.aws/credentials` file (`default` profile or `AWS_PROFILE`)
3. IAM Instance Profile (when running on EC2)
4. ECS Task Role / EKS Service Account

The same credentials are used for `sts:GetCallerIdentity` (automatic account ID). The region is passed explicitly to every scanner via `AwsRegion`.

---

## Test structure

- **Domain** — pure logic, zero dependencies: entities, value objects and above all the **policies** (grace period, tags, AMI, traffic windows) with fixed, deterministic dates.
- **Application** — the coordinator is tested with fake in-memory scanners:
  ```typescript
  const scanner: WasteScannerPort = {
    kind: 'ebs-volume',
    scan: async () => Result.ok([makeVolume('vol-1')]),
  };
  ```
  No mocking framework. The cases cover aggregation, errors per (kind, region) and preservation of partial results. `toWasteReportDto` has a JSON round-trip test.
- **Scanners (infrastructure)** — the AWS SDK module is mocked with `jest.mock(...)`; tests verify mapping, server-side filters, pagination, error handling, client `destroy()` and policy application (recent resource → excluded, tag → excluded). For multi-command calls the mocks route on the type of the received `Command`.

> Note: these tests mock the SDK, so they validate *our* code, not the real integration with AWS. An eventual integration suite against LocalStack would be the next sensible quality investment.
