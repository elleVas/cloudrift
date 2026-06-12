import {
  EC2Client,
  DescribeNatGatewaysCommand,
  type NatGateway as AwsNatGateway,
} from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { NatGatewayRepositoryPort, AwsRegion, PricingPort } from 'cloud-cost-domain';
import { NatGateway } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

// Lookback window: 48h is enough to catch gateways that have been idle for at least 2 days
const LOOKBACK_HOURS = 48;

export class AwsNatGatewayRepositoryAdapter implements NatGatewayRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
  ) {}

  async findIdleGateways(
    region: AwsRegion,
  ): ReturnType<NatGatewayRepositoryPort['findIdleGateways']> {
    const ec2 = new EC2Client({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const gateways = await paginate<AwsNatGateway>(async (cursor) => {
        const r = await ec2.send(
          new DescribeNatGatewaysCommand({
            Filter: [{ Name: 'state', Values: ['available'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.NatGateways ?? [], cursor: r.NextToken };
      });

      if (gateways.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);
      const monthlyCostUsd = this.pricing.getNatGatewayPricePerMonth(region);

      const idleResults = await Promise.all(
        gateways.map(async (gw) => {
          const metrics = await cw.send(
            new GetMetricStatisticsCommand({
              Namespace: 'AWS/NATGateway',
              MetricName: 'BytesOutToDestination',
              Dimensions: [{ Name: 'NatGatewayId', Value: gw.NatGatewayId! }],
              StartTime: startTime,
              EndTime: endTime,
              Period: LOOKBACK_HOURS * 3600,
              Statistics: ['Sum'],
            }),
          );
          const totalBytes = metrics.Datapoints?.[0]?.Sum ?? 0;
          return totalBytes === 0 ? gw : null;
        }),
      );

      const idle = idleResults
        .filter((gw): gw is AwsNatGateway => gw !== null)
        .map(
          (gw) =>
            new NatGateway({
              natGatewayId: gw.NatGatewayId!,
              region,
              accountId: this.accountId,
              vpcId: gw.VpcId ?? 'unknown',
              createTime: gw.CreateTime ?? new Date(0),
              detectedAt: new Date(),
              tags: Object.fromEntries(
                (gw.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
              ),
              monthlyCostUsd,
            }),
        );

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('NAT', err as Error));
    } finally {
      ec2.destroy();
      cw.destroy();
    }
  }
}
