# How the code works

> 🇮🇹 [Versione italiana](../it/funzionamento.md)

This document describes the full execution flow, from CLI invocation to the AWS responses and the rendering of results.

---

## End-to-end execution flow

```
user: cloudrift analyze -r us-east-1 eu-west-1 [--format json|markdown] [--pdf] [--live-pricing]
                         [--scanners <kinds...> | --all-services]
          │
          ▼
     apps/cli/src/main.ts
     Commander.js parses the arguments
          │
          ▼
     analyze-waste.command.ts  (orchestrates options/config/output)
     0. scannerKinds: --all-services | --scanners <kinds...> | interactive wizard
        (TTY only, skipped in CI/non-TTY/--silent) | undefined (run every scanner)
     1. loadConfig() — cloudrift.config.json / .cloudriftrc / --config
     2. AwsRegion.parse() per region; config.excludeRegions filtered out
     3. accountId: --account-id or STS GetCallerIdentity
          │
          ▼
     analyze-waste.composition.ts  (composition root: builds pricing + scanners)
     4. Pricing: static table ← live API (--live-pricing) ← config.prices (wins)
     5. Instantiates policies (config + flags), then builds scanners from two
        declarative registries (ADR-0043): ALWAYS_ON_SCANNERS, and
        LIVE_PRICING_SCANNERS (EC2/RDS/Redshift/OpenSearch/MSK/DocumentDB/
        Neptune/MQ underutilized-or-idle + WorkSpaces — only when
        --live-pricing is set, since their per-type price isn't in the
        static table). assertRegistryMatchesResourceKinds() throws at
        module load if a kind is missing from, or duplicated across, the
        two registries.
     6. Filters the built list down to scannerKinds from step 0 (undefined = no filter)
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Flattens (scanner × region) into a FIFO job queue consumed by a worker
     pool (12 in-flight scans max, any scanner/region mix)
          │
     ┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
     ▼             ▼             ▼             ▼             ▼             ▼
   EC2 API       RDS API      ELBv2 API     S3+CW API    Lambda+CW     EFS+CW API
  (volumes,     (instances,   (target       (buckets,    API          (file systems,
   instances,    underutil.*)  groups/      lifecycle)   (functions,   mount targets,
   snapshots,                  health)                    invocations)  I/O)
   NAT, ENI,
   underutil.*)
     │
     ▼
  DynamoDB API           CloudWatch Logs API     ElastiCache+CW+Pricing API
  (tables, capacity)     (log groups, retention)  (clusters, connections)*
          │        (* CW=CloudWatch, max 5 concurrent; on-demand-priced scanners
          │         — EC2/RDS underutilized, ElastiCache idle — registered only
          │         with --live-pricing, since the static table has no per-type price)
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
  .option('--scanners <kinds...>', 'only run these services …')
  .option('--all-services', 'run every scanner without the interactive picker …')
  .option('--min-age-days <days>', 'grace period …', '7')
  .option('--ignore-tag <tag>', 'resources carrying this tag are excluded …', 'cloudrift:ignore')
  .option('--pdf [filename]', 'Export a PDF report …')
  .option('--json [filename]', 'Output the report as JSON …')
  .option('--silent', 'suppress all stdout output …')
  .action(analyzeWasteCommand);
```

`--pdf` and `--json` accept an optional filename and are file artifacts, independent of `--format`: by default the chosen `--format` (table) still prints to stdout *in addition to* writing the file. To get JSON only on stdout (composable: `cloudrift analyze --format json | jq '.totalWasteMonthlyUsd'`), pass `--format json` explicitly. To suppress stdout entirely and only write the file(s), add `--silent`.

`main.ts` also registers three sibling commands: `cost` and `trend` (spend comparison/trend via AWS Cost Explorer — the only billed API in the CLI, see [architecture.md](./architecture.md#cost-analytics-cost--trend)), and `dead-resources` (hygiene findings with no direct AWS cost — a different domain entirely from `WastedResource`, see [architecture.md](./architecture.md#dead-resources-dead-resources)); plus one non-command branch: `process.argv.length === 2 && isInteractiveTty()` (no subcommand, real terminal) skips Commander entirely and hands off to `runEntryWizard()` instead, which gathers the same options interactively and calls `analyzeWasteCommand`/`costCommand`/`trendCommand`/`deadResourcesCommand` directly — see [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md). This file stays focused on the `analyze` flow below, since it's the original and still the largest; `cost`/`trend`/`dead-resources` all follow the same command → composition → use-case → port shape at a fraction of the size (`cost`/`trend`: no scanners, one external call; `dead-resources`: same scanner-plugin shape as `analyze` but a 4-entry registry instead of 43, see [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)).

---

### `analyze-waste.command.ts` — Orchestration

Resolves CLI options into config + regions + account ID, delegates pricing/scanner construction to `analyze-waste.composition.ts` through the injectable `AnalyzeDeps.createAnalysis` seam (the fake used by `analyze-waste.command.spec.ts` to test without AWS), then renders the chosen format and writes the `--json`/`--pdf` artifacts.

#### Scanner selection: the wizard and its escape hatches

Before building the pricing/scanner set, the command resolves which `ResourceKind`s to run, in this order:

1. `--all-services` → run everything, no prompt.
2. `--scanners <kinds...>` → the given list, validated against `RESOURCE_KINDS` (an unknown kind fails fast with the full valid list).
3. Otherwise, only when `process.stdout.isTTY` and not `CI=true` (and not `--silent`): `promptScannerSelection()` (`apps/cli/src/wizard/scanner-selection.wizard.ts`) shows a `@clack/prompts` multiselect — every kind pre-checked, so pressing Enter reproduces the old scan-everything default. Ctrl+C cancels cleanly with no scan run.
4. Otherwise (CI, piped stdout, or `--silent`): every scanner runs, same as before this feature existed — the picker never blocks automation.

The resolved list (or `undefined` for "all") flows into `AnalysisContext.scannerKinds`, which `analyze-waste.composition.ts` uses to filter the scanners it builds (see below). `@clack/prompts` is an ESM-only package and is loaded with a dynamic `import()` inside `promptScannerSelection()` rather than a static import, so Jest never has to parse it on the non-interactive test path.

### `analyze-waste.composition.ts` — Composition root

The only place where concrete implementations are instantiated and injected. Scanners come from two declarative registries rather than a hand-written list ([ADR-0043](../adr/0043-declarative-scanner-registry.md)):

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
const ctx: ScannerContext = { pricing, accountId, policyOptions, livePricingAdapter };

// Each entry: { kind, create(ctx) }. assertRegistryMatchesResourceKinds()
// throws at module load if a ResourceKind is missing from, or duplicated
// across, the two registries below — see ADR-0043.
const ALWAYS_ON_SCANNERS: ScannerRegistryEntry[] = [
  { kind: 'ebs-volume', create: (ctx) => new AwsEbsVolumeScanner(ctx.pricing, ctx.accountId, new EbsVolumeWastePolicy(ctx.policyOptions)) },
  { kind: 'elastic-ip', create: (ctx) => new AwsElasticIpScanner(ctx.pricing, ctx.accountId, new ElasticIpWastePolicy(ctx.policyOptions)) },
  // … one entry per always-on kind (rds, lb, ec2, snapshot, nat, gp2-upgrade, ebs-idle,
  // log-group, eni-orphaned, s3-no-lifecycle, lambda-underutilized, efs-unused,
  // dynamodb-overprovisioned, fsx-idle, vpn-connection-idle, transit-gateway-idle, kinesis-idle)
];

// Built only when ctx.livePricingAdapter is set (--live-pricing): these need a
// per-instance-type/class/node-type price the static table doesn't carry.
const LIVE_PRICING_SCANNERS: ScannerRegistryEntry[] = [
  { kind: 'ec2-underutilized', create: (ctx) => new AwsEc2UnderutilizedScanner(ctx.livePricingAdapter, ctx.accountId, new Ec2UnderutilizedPolicy(ctx.policyOptions)) },
  // … one entry per --live-pricing-gated kind (rds/redshift/opensearch/msk/documentdb/
  // neptune/mq underutilized-or-idle, elasticache-idle, workspaces-idle)
];

const registry = livePricingAdapter ? [...ALWAYS_ON_SCANNERS, ...LIVE_PRICING_SCANNERS] : ALWAYS_ON_SCANNERS;
const scanners = registry
  .filter((entry) => !ctx.scannerKinds || ctx.scannerKinds.includes(entry.kind)) // wizard/--scanners/--all-services; undefined = no filter
  .map((entry) => entry.create(ctx));

const useCase = new AnalyzeCloudWasteUseCase(scanners);
const result = await useCase.execute({ regions });
```

The account ID is resolved via `sts:GetCallerIdentity` with the same credentials as the scan; `--account-id` remains as an override and `'unknown'` is the fallback when STS is unreachable.

---

### `AnalyzeCloudWasteUseCase` — Generic coordinator

```typescript
const jobs = this.scanners.flatMap((scanner) =>
  request.regions.map((region) => ({ scanner, region })),
);

let nextJob = 0;
const worker = async () => {
  while (nextJob < jobs.length) {
    const { scanner, region } = jobs[nextJob++];
    const result = await scanner.scan(region);
    if (result.ok) findings.push(...result.value);
    else scanErrors.push({ kind: scanner.kind, region: region.code, error: result.error });
  }
};
await Promise.all(Array.from({ length: workerCount }, () => worker())); // default 12
```

Three properties worth noting:

1. **Generic**: the coordinator does not know the resource types; adding a scanner does not modify it.
2. **Error granularity per (scanner, region)**: if `eu-west-1` is not enabled, the `us-east-1` results for the same resource type survive, and the error reports both the kind and the region.
3. **Concurrency profile**: one global bound (12 in-flight scans by default, configurable via the use-case constructor) over every (scanner, region) pair — see [ADR-0052](../adr/0052-global-scan-worker-pool.md). Jobs are queued scanner-major, so the first batch the workers pull spreads across regions instead of concentrating on the first one; total scan time approaches `total work / 12` instead of `regions × slowest scanner`.

The total cost is the sum of the findings' `costEstimate`s; failed types simply do not contribute (and the report flags the incompleteness).

---

### The scanners (e.g. `AwsEbsVolumeScanner`)

Every scanner implements `WasteScannerPort`. 23 of the 38 also fetch a CloudWatch metric per resource and extend the shared `CloudWatchIdleScanner` template method instead of implementing the steps below by hand — see [ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md) and [technical-choices.md](./technical-choices.md#cloudwatchidlescanner--shared-template-method-for-cloudwatch-based-scanners). The other 15 (including this one) follow the same scheme directly:

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

#### `AwsS3NoLifecycleScanner` — Region-filtered global resource

S3 buckets are **global**, not per-region: `ListBucketsCommand({ BucketRegion: region.code })` uses the (2024+) region filter so each region scan only ever sees the buckets that actually belong to it — without it, the same bucket would be reported once per scanned region. For each bucket it calls `GetBucketLifecycleConfiguration`, treating the `NoSuchLifecycleConfiguration` error name as "no policy" (any other error propagates and fails the scan), and reads `BucketSizeBytes` from CloudWatch (`AWS/S3`, daily metric, `StorageType=StandardStorage`). The estimated saving is a flat fraction (`ESTIMATED_SAVING_FRACTION = 0.4`) of the current Standard storage cost — advisory, since we don't know which objects are actually cold.

#### `AwsEfsUnusedScanner` — No `DescribeMountTargets` needed

`DescribeFileSystems` already returns `NumberOfMountTargets` and `SizeInBytes` per file system, so unlike a naive implementation this scanner needs no second API call to know whether a file system is reachable. CloudWatch (`DataReadIOBytes` + `DataWriteIOBytes`, summed) is only queried for file systems that **do** have a mount target — an orphan file system (zero mount targets) is waste by definition and the metric call is skipped entirely.

#### `AwsDynamoDbOverprovisionedScanner` — Two-level fan-out

The only scanner that needs a fan-out **before** CloudWatch: `ListTables` returns table names only, so a `DescribeTable` call per name (capped via `mapWithConcurrency`) resolves the `BillingModeSummary`/`ProvisionedThroughput` needed to decide if a table is even `PROVISIONED` (vs. `PAY_PER_REQUEST`, which is skipped — there's no fixed capacity to be "over"). Only then does it fetch `ConsumedReadCapacityUnits`/`ConsumedWriteCapacityUnits` for the provisioned tables. Utilization is `consumed / windowSeconds / provisioned`; the policy flags a table only when **both** read and write utilization are below threshold (a table read-heavy and write-light is correctly sized for its heavier dimension, not overprovisioned).

#### `AwsElastiCacheIdleScanner` — Real cost, live-pricing gated like EC2/RDS

Lists clusters, sums `CurrConnections` over the window — zero connections is an unambiguous idle signal (unlike CPU-based heuristics, no threshold tuning needed). Unlike Lambda (genuinely $0 when idle), an ElastiCache node is billed per node-hour regardless of usage, so this is real money — but the node-type price space is as large as EC2's, hence the same on-demand Pricing API resolution (`getElastiCacheNodePricePerMonth`, duck-typed like `Ec2InstancePricingSource`) and the same `--live-pricing` gate. Because the price, once resolved, is exact rather than a heuristic fraction, the kind is `estimated: false` and category `waste` — the only live-pricing-gated scanner that isn't advisory.

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
EfsFileSystem.numberOfMountTargets         // → hasNoMountTargets()
OverprovisionedDynamoDbTable.avgReadUtilizationPercent  // consumed/provisioned/window
IdleElastiCacheCluster.connectionsLastWindow            // → isIdle()
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

`--format` (`table` | `json` | `markdown`) selects what goes to stdout; `--pdf` / `--json [filename]` write additional files, independent of `--format`. In machine-readable formats the human chrome is routed to stderr so stdout carries only the report. `--silent` suppresses stdout entirely (chrome and report), for file-only runs.

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

**Exception: `AwsEc2UnderutilizedScanner`, `AwsRdsUnderutilizedScanner` and `AwsElastiCacheIdleScanner`.** Per-instance-type/class/node-type prices aren't in `prices.json` (too many distinct types to maintain) and aren't pre-warmed by `warmUp()`. These three scanners instead call `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)` / `getRdsInstancePricePerMonth(region, instanceClass, engine, deploymentOption)` / `getElastiCacheNodePricePerMonth(region, cacheNodeType)` directly, on demand, for each distinct type found — which is why these are the only three scanners that need `--live-pricing` to even be registered, rather than degrading gracefully to a static fallback like the others. DynamoDB is not an exception here: RCU/WCU prices are uniform per region (not per-table-type), so they live in `prices.json` like any other static price.

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

> Note: these tests mock the SDK, so they validate *our* code, not the real integration with AWS. [`scripts/e2e-localstack.mjs`](../../scripts/e2e-localstack.mjs) closes part of that gap (17/43 scanners, see [testing.md](./testing.md#localstack-e2e-harness)); the rest is `scripts/verify-against-aws.mjs` against a real sandbox account, plus a separate real-AWS verification pass covering 36/43 scanners overall (see [testing.md](./testing.md#real-aws-verification-status-broader-than-verify-against-awsmjs)). A fuller contract-test suite (real captured AWS response fixtures validated against the mappers, independent of a live LocalStack/AWS run) remains the next sensible quality investment.
