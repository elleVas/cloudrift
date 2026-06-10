# cloud-cost-infrastructure-aws-adapter

AWS SDK v3 adapters that implement the outbound ports defined in `cloud-cost-domain`.

## Adapters

### `AwsEbsVolumeRepositoryAdapter`

Calls `EC2::DescribeVolumes` filtered by `status=available`. Creates a per-region `EC2Client` instance (destroyed after use).

### `AwsElasticIpRepositoryAdapter`

Calls `EC2::DescribeAddresses` filtered by `domain=vpc`, then filters out any address that has an `AssociationId`.

### `AwsRdsInstanceRepositoryAdapter`

Calls `RDS::DescribeDBInstances` filtered by `db-instance-status=stopped`. Maps each result to an `RdsInstance` entity.

### `AwsLoadBalancerRepositoryAdapter`

Calls `ELBv2::DescribeLoadBalancers` to list all ALBs and NLBs (gateway type is excluded). For each LB it calls `ELBv2::DescribeTargetGroups` and then `ELBv2::DescribeTargetHealth` for every target group to count registered targets. LBs with zero registered targets across all target groups are returned.

## AWS permissions required

The IAM principal running this tool needs the following read-only permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeVolumes",
    "ec2:DescribeAddresses",
    "rds:DescribeDBInstances",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth"
  ],
  "Resource": "*"
}
```

## Error handling

All adapters catch SDK errors and wrap them in `AwsAdapterError`, which is a typed `DomainError`. The `service` field identifies which AWS service failed. The use case layer propagates the error as `Result.fail`.

## Building

```sh
pnpm nx build cloud-cost-infrastructure-aws-adapter
```

## Testing

```sh
pnpm nx test cloud-cost-infrastructure-aws-adapter
```
