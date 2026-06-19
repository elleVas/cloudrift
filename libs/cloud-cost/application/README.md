# cloud-cost-application

Application layer for the cloud-cost bounded context. Contains the generic use case that orchestrates domain logic (scanners + policies) and projects the result into a serializable DTO. Has no dependency on any infrastructure adapter.

## Use Cases

### `AnalyzeCloudWasteUseCase`

The single coordinator. Accepts an array of `WasteScannerPort` via constructor injection — it does not know how many scanners there are or which resource types they cover — and runs them in parallel with each other, sequentially per region. Returns a `WastedResourcesSummary` with every finding, the waste/optimization totals and any per-(scanner, region) errors.

```typescript
const useCase = new AnalyzeCloudWasteUseCase([
  new AwsEbsVolumeScanner(pricing, accountId, new EbsVolumeWastePolicy(policyOptions)),
  new AwsElasticIpScanner(pricing, accountId, new ElasticIpWastePolicy(policyOptions)),
  // … the rest of the registered scanners (currently 10, one of them gated on --live-pricing)
]);

const result = await useCase.execute({ regions: [AwsRegion.create('us-east-1')] });
if (result.ok) {
  console.log(result.value.totalWasteMonthlyUsd);        // deletable waste, feeds the CI gate
  console.log(result.value.totalOptimizationMonthlyUsd);  // savings opportunities, estimated, not gated
}
```

Adding a resource type never touches this use case: it is generic over `WasteScannerPort[]`. See [`docs/en/adding-a-resource.md`](../../../docs/en/adding-a-resource.md).

### `toWasteReportDto`

Projects `WastedResourcesSummary` into `WasteReportDto`, a JSON-safe structure (primitives and ISO strings only) — the data contract for the CLI formatters (table, PDF, JSON, Markdown) and any future presentation (e.g. an HTTP API).

## Error handling

`AnalyzeCloudWasteUseCase.execute()` returns `Result<WastedResourcesSummary>`. Individual scanner failures are collected per `(kind, region)` in `scanErrors` rather than short-circuiting the whole scan: a failure in one resource type or region never discards the results of the others. The CLI surfaces `scanErrors` as warnings and converts a top-level `Result.fail` into a non-zero exit code.

## Building

```sh
pnpm nx build cloud-cost-application
```

## Testing

```sh
pnpm nx test cloud-cost-application
```
