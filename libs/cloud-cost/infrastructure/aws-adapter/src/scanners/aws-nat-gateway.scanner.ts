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
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { NatGateway, NatGatewayWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
// Limits concurrent CloudWatch calls to avoid throttling on accounts
// with many NAT Gateways.
const CLOUDWATCH_CONCURRENCY = 5;

export class AwsNatGatewayScanner implements WasteScannerPort {
  readonly kind = 'nat-gateway' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new NatGatewayWastePolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
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
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const monthlyCostUsd = this.pricing.getNatGatewayPricePerMonth(region);

      const bytesPerGateway = await mapWithConcurrency(
        gateways,
        CLOUDWATCH_CONCURRENCY,
        async (gw) => {
          const metrics = await cw.send(
            new GetMetricStatisticsCommand({
              Namespace: 'AWS/NATGateway',
              MetricName: 'BytesOutToDestination',
              Dimensions: [{ Name: 'NatGatewayId', Value: gw.NatGatewayId! }],
              StartTime: startTime,
              EndTime: endTime,
              Period: this.windowHours * 3600,
              Statistics: ['Sum'],
            }),
          );
          return metrics.Datapoints?.[0]?.Sum ?? 0;
        },
      );

      const now = new Date();
      const idle = gateways
        .map(
          (gw, index) =>
            new NatGateway({
              natGatewayId: gw.NatGatewayId!,
              region,
              accountId: this.accountId,
              vpcId: gw.VpcId ?? 'unknown',
              createTime: gw.CreateTime ?? new Date(0),
              detectedAt: now,
              bytesOutLastWindow: bytesPerGateway[index],
              metricWindowHours: this.windowHours,
              tags: Object.fromEntries(
                (gw.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
              ),
              monthlyCostUsd,
            }),
        )
        .filter((gateway) => this.policy.evaluate(gateway, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('NAT', err as Error));
    } finally {
      ec2.destroy();
      cw.destroy();
    }
  }
}
