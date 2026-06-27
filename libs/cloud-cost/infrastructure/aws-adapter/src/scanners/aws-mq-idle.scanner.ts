// SPDX-License-Identifier: Apache-2.0
import { MqClient, ListBrokersCommand, type BrokerSummary } from '@aws-sdk/client-mq';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { MqBroker, MqIdleBrokerPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

export interface MqBrokerPricingSource {
  getMqBrokerPricePerMonth(region: AwsRegion, hostInstanceType: string): Promise<number | undefined>;
}

/**
 * Detects Amazon MQ brokers with zero network traffic in the observed
 * window. `NetworkIn` is used as the idle signal because it's reported for
 * both supported engines (ActiveMQ and RabbitMQ), unlike connection/consumer
 * count metrics which are engine-specific. Requires `--live-pricing`:
 * without a price per broker instance type, no saving can be estimated.
 */
export class AwsMqIdleScanner implements WasteScannerPort {
  readonly kind = 'mq-idle-broker' as const;

  constructor(
    private readonly pricing: MqBrokerPricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new MqIdleBrokerPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const mq = new MqClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const brokers = await paginate<BrokerSummary>(async (cursor) => {
        const r = await mq.send(new ListBrokersCommand({ NextToken: cursor }));
        return { items: r.BrokerSummaries ?? [], cursor: r.NextToken };
      });

      const running = brokers.filter((b) => b.BrokerState === 'RUNNING');
      if (running.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const networkBytes = await mapWithConcurrency(running, CLOUDWATCH_CONCURRENCY, (broker) =>
        this.sumNetworkIn(cw, broker.BrokerId!, startTime, endTime, periodSeconds),
      );

      const instanceTypes = [...new Set(running.map((b) => b.HostInstanceType ?? 'unknown'))];
      const priceEntries = await mapWithConcurrency(instanceTypes, CLOUDWATCH_CONCURRENCY, async (instanceType) => ({
        instanceType,
        price: (await this.pricing.getMqBrokerPricePerMonth(region, instanceType)) ?? 0,
      }));
      const priceByType = new Map(priceEntries.map((e) => [e.instanceType, e.price]));

      const now = new Date();
      const idle = running
        .map((broker, index) => {
          const hostInstanceType = broker.HostInstanceType ?? 'unknown';
          const deploymentMode = broker.DeploymentMode ?? 'SINGLE_INSTANCE';
          const brokerCount = deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ' ? 2 : 1;
          const monthlyPrice = (priceByType.get(hostInstanceType) ?? 0) * brokerCount;
          return new MqBroker({
            brokerId: broker.BrokerId!,
            brokerName: broker.BrokerName ?? broker.BrokerId!,
            region,
            accountId: this.accountId,
            hostInstanceType,
            deploymentMode,
            networkBytesLastWindow: networkBytes[index],
            metricWindowHours: this.windowHours,
            created: broker.Created ?? new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +monthlyPrice.toFixed(4),
          });
        })
        .filter((broker) => this.policy.evaluate(broker, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('MQ', err as Error));
    } finally {
      mq.destroy();
      cw.destroy();
    }
  }

  private async sumNetworkIn(
    cw: CloudWatchClient,
    brokerId: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/AmazonMQ',
        MetricName: 'NetworkIn',
        Dimensions: [{ Name: 'Broker', Value: brokerId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
