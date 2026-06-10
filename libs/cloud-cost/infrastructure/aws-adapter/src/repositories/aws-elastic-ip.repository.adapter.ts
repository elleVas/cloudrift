import {
  EC2Client,
  DescribeAddressesCommand,
  type Address,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { ElasticIpRepositoryPort, AwsRegion, PricingPort } from 'cloud-cost-domain';
import { ElasticIp } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

export class AwsElasticIpRepositoryAdapter implements ElasticIpRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId: string = 'unknown',
  ) {}

  async findUnassociatedElasticIps(
    region: AwsRegion,
  ): ReturnType<ElasticIpRepositoryPort['findUnassociatedElasticIps']> {
    const client = new EC2Client({ region: region.code });
    try {
      const response = await client.send(
        new DescribeAddressesCommand({
          Filters: [{ Name: 'domain', Values: ['vpc'] }],
        }),
      );

      const unassociated = (response.Addresses ?? [])
        .filter((a: Address) => !a.AssociationId)
        .map(
          (a: Address) =>
            new ElasticIp({
              allocationId: a.AllocationId!,
              publicIp: a.PublicIp!,
              region,
              accountId: this.accountId,
              detectedAt: new Date(),
              associationId: a.AssociationId,
              instanceId: a.InstanceId,
              tags: Object.fromEntries(
                (a.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
              ),
              monthlyCostUsd: this.pricing.getElasticIpPricePerMonth(region),
            }),
        );

      return Result.ok(unassociated);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ElasticIP', err as Error));
    } finally {
      client.destroy();
    }
  }
}
