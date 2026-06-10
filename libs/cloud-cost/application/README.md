# cloud-cost-application

Application layer for the cloud-cost bounded context. Contains use cases that orchestrate domain logic and outbound ports. Has no dependency on any infrastructure adapter.

## Use Cases

### `AnalyzeCloudWasteUseCase`

The top-level orchestrator. Accepts repository adapters via constructor injection and fans out to all resource-specific use cases in parallel. Returns a `WastedResourcesSummary` with every wasted resource found and the total estimated monthly cost.

```typescript
const useCase = new AnalyzeCloudWasteUseCase(
  new AwsEbsVolumeRepositoryAdapter(),
  new AwsElasticIpRepositoryAdapter(),
  new AwsRdsInstanceRepositoryAdapter(),
  new AwsLoadBalancerRepositoryAdapter(),
);

const result = await useCase.execute({ regions: [AwsRegion.create('us-east-1')] });
if (result.ok) {
  console.log(result.value.totalMonthlyCostUsd);
}
```

### `FindUnattachedEbsVolumesUseCase`

Iterates over the given regions sequentially, collects unattached EBS volumes (state `available`) via the repository port.

### `FindUnassociatedElasticIpsUseCase`

Iterates over regions, collects Elastic IPs that have no association ID.

### `FindStoppedRdsInstancesUseCase`

Iterates over regions, collects RDS DB instances in `stopped` status.

### `FindIdleLoadBalancersUseCase`

Iterates over regions, collects Application and Network Load Balancers that have no registered targets across any of their target groups.

## Error handling

All use cases return `Result<T>`. On the first repository failure the use case short-circuits and propagates the error upward. The CLI converts `Result.fail` into a non-zero exit code.

## Building

```sh
pnpm nx build cloud-cost-application
```

## Testing

```sh
pnpm nx test cloud-cost-application
```
