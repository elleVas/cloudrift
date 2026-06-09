# cloud-cost-domain

The domain layer for the cloud-cost bounded context. Contains entities, value objects, and port interfaces. Has no runtime dependencies outside `shared-kernel`.

## Entities

### `EbsVolume`

Represents an AWS EBS volume. Key behaviour:

- `isUnattached()` — `true` when `state === 'available'` (not mounted to any EC2 instance)
- `costEstimate` — computes monthly cost from `sizeGb × pricePerGB` for the given volume type

### `ElasticIp`

Represents an Elastic IP address in VPC scope. Key behaviour:

- `isUnassociated()` — `true` when there is no `associationId` (not bound to EC2/NAT)
- `costEstimate` — fixed $3.60/month (AWS charges $0.005/hr for unassociated EIPs)

### `RdsInstance`

Represents an RDS DB instance. Key behaviour:

- `isStopped()` — `true` when `dbInstanceStatus === 'stopped'`
- `costEstimate` — storage-only cost for a stopped instance (instance hours are waived for up to 7 days, then resume)

### `LoadBalancer`

Represents an Application or Network Load Balancer. Key behaviour:

- `costEstimate` — ~$16.20/month base charge (idle LBs with no registered targets still incur hourly fees)

## Value Objects

### `AwsRegion`

Thin wrapper around an AWS region code string (e.g. `us-east-1`). Created via `AwsRegion.create(code)`.

### `CostEstimate`

Monthly cost estimate in USD with a human-readable description. Factory methods:

| Method | Inputs |
|---|---|
| `forEbsVolume(sizeGb, volumeType)` | volume size and type |
| `forUnassociatedElasticIp()` | none |
| `forStoppedRdsInstance(storageGb, storageType)` | allocated storage size and type |
| `forIdleLoadBalancer(type)` | LB type string |

`format()` returns `"$X.XX/mo"`.

## Ports

### Inbound (driven by use cases)

- `FindWastedResourcesUseCasePort` — the primary interface the CLI drives; returns `WastedResourcesSummary`

### Outbound (implemented by infrastructure)

- `EbsVolumeRepositoryPort`
- `ElasticIpRepositoryPort`
- `RdsInstanceRepositoryPort`
- `LoadBalancerRepositoryPort`

## Building

```sh
pnpm nx build cloud-cost-domain
```

## Testing

```sh
pnpm nx test cloud-cost-domain
```
