# How the code works

> 🇮🇹 [Versione italiana](../it/funzionamento.md)

This document describes the full execution flow, from CLI invocation to the AWS responses and the rendering of results.

---

## End-to-end execution flow

```
user: cloudrift analyze -r us-east-1 eu-west-1 [--pdf] [--json] [--min-age-days 7]
          │
          ▼
     apps/cli/src/main.ts
     Commander.js parses the arguments
          │
          ▼
     analyze-waste.command.ts  (composition root)
     1. AwsRegion.parse() for each region (clean error on invalid input)
     2. accountId: --account-id or STS GetCallerIdentity
     3. Instantiates pricing, policies (config + --min-age-days / --ignore-tag) and the 8 scanners
          │
          ▼
     AnalyzeCloudWasteUseCase.execute({ regions })
     Runs the registered scanners in parallel (Promise.all),
     each scanner iterates the regions sequentially
          │
     ┌────┬────┬────┬────┬────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼    ▼    ▼    │ (one per ResourceKind)
   EBS  EIP  RDS  ELB  EC2  Snap  NAT   │
  scan  scan scan scan scan scan  scan  │
     │    │    │    │    │    │    │
     ▼    ▼    ▼    ▼    ▼    ▼    ▼
  EC2  EC2  RDS ELBv2 EC2* EC2** EC2+CW
  API  API  API  API  API  API   API
          │        (* 2 calls; ** 3 calls; CW=CloudWatch, max 5 concurrent)
          ▼
     Each scanner applies the domain waste policy
     (grace period, exclusion tag, type-specific criteria)
          │
          ▼
     WastedResourcesSummary { findings: WastedResource[],
                              totalMonthlyCostUsd, scanErrors }
          │
          ├──────────────────────────┬───────────────────────────┐
          ▼                          ▼ (--pdf)                   ▼ (--json)
  formatWasteReportAsTable    generateWasteReportPdf      formatWasteReportAsJson
  (cli-table3 + chalk)        (pdfkit, with page breaks)  (WasteReportDto, JSON-safe)
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

`--pdf` and `--json` accept an optional filename. `--json` with no filename prints **only** the JSON to stdout (the table output is suppressed), making the command composable: `cloudrift analyze --json | jq '.totalMonthlyCostUsd'`.

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
  // … the other 5
];

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

---

### Entities and Value Objects

All entities implement `WastedResource` and freeze their props (`Object.freeze`). Besides the common fields (`accountId`, `detectedAt`, `tags`, `monthlyCostUsd`), every entity carries the facts its policy needs:

```typescript
// Examples of decision "facts"
LoadBalancer.registeredTargetCount  // → isIdle()
NatGateway.bytesOutLastWindow       // → isIdle()
EbsSnapshot.sourceVolumeExists      // → isOrphan()
EbsSnapshot.boundToAmiId            // → not deletable
Ec2Instance.stoppedSince            // → grace period on the actual stop
```

`CostEstimate.of(monthlyCostUsd, description)` is the only factory: price computation lives in the infrastructure (`StaticPriceTableAdapter` + `prices.json`), never in the domain.

---

### Formatters

The three formatters share the `resource-presenters.ts` registry (CLI):

```typescript
export const presenters: { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> } = {
  'ebs-volume': { title, head, colWidths, row(v), recommend(v) },
  // … satisfies guarantees exhaustiveness at compile time
};
```

- **Console table** (`waste-report.table-formatter.ts`): iterates `RESOURCE_KINDS`, uses `groupByKind(findings)` and the presenter for headers and rows. At the end: warnings per (kind, region), total and a disclaimer with the price table date.
- **PDF** (`waste-report.pdf-formatter.ts`): executive summary page (totals, breakdown, top 8 recommendations from `presenter.recommend`) + one page per kind. `drawTable` handles **page breaks**: when a table exceeds the bottom margin, it closes the border, opens a new page and redraws the header.
- **JSON** (`waste-report.json-formatter.ts`): serializes `toWasteReportDto(summary, meta)` — the data contract for dashboards, CI or a future frontend.
- **Markdown** (`waste-report.markdown-formatter.ts`): a Pull-Request-ready report (totals, breakdown, collapsible `<details>` per kind, top recommendations, cost-threshold callout) for `--format markdown` in CI.

`--format` (`table` | `json` | `markdown`) selects what goes to stdout; `--pdf` / `--json [filename]` write additional files. In machine-readable formats the human chrome is routed to stderr so stdout carries only the report.

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
