# mcp-server-application

Application layer for the MCP server input adapter. Contains the single use case that orchestrates
the four existing bounded contexts (`cloud-cost`, `dead-resources`, `resource-security`, `cost-analytics`)
behind their inbound domain ports. Has no dependency on any `*-application` lib, any infrastructure
adapter, AWS, or the MCP protocol itself — it is new orchestration logic, not glue code for a specific
transport.

## Use Cases

### `AggregateAnalysisUseCase`

Runs the four domain use cases in parallel and composes their summaries into one report. A domain
whose use case returns `Result.fail` is recorded in `domainErrors` and omitted from the report — the
other three domains are unaffected, mirroring the per-`(kind, region)` `scanErrors` pattern each domain
already uses internally.

```typescript
const useCase = new AggregateAnalysisUseCase(
  cloudWasteUseCase,      // FindWastedResourcesUseCasePort
  deadResourcesUseCase,   // FindDeadResourcesUseCasePort
  resourceSecurityUseCase,// FindResourceSecurityFindingsUseCasePort
  costTrendUseCase,       // CostTrendUseCasePort
);

const result = await useCase.execute({ regions: [AwsRegion.create('us-east-1')] });
if (result.ok) {
  console.log(result.value.cloudWaste?.totalWasteMonthlyUsd);
  console.log(result.value.domainErrors); // failures, if any, per domain
}
```

The caller (the CLI's `mcp` subcommand composition root) is responsible for building the four concrete
use cases with real AWS infrastructure — this lib only knows about domain ports.

## Building

```sh
pnpm nx build mcp-server-application
```

## Testing

```sh
pnpm nx test mcp-server-application
```
