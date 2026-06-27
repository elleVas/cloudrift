// SPDX-License-Identifier: Apache-2.0
import { KafkaClient, ListClustersV2Command, type Cluster } from '@aws-sdk/client-kafka';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { MskCluster, MskIdleClusterPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

export interface MskBrokerPricingSource {
  getMskBrokerPricePerMonth(region: AwsRegion, brokerInstanceType: string): Promise<number | undefined>;
}

/**
 * Detects MSK Provisioned clusters (Serverless bills per use, out of scope
 * per ADR-0038) with zero broker traffic in the observed window. Requires
 * `--live-pricing`: without a price per broker instance type, no saving
 * can be estimated.
 */
export class AwsMskIdleScanner implements WasteScannerPort {
  readonly kind = 'msk-idle-cluster' as const;

  constructor(
    private readonly pricing: MskBrokerPricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new MskIdleClusterPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const kafka = new KafkaClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const clusters = await paginate<Cluster>(async (cursor) => {
        const r = await kafka.send(
          new ListClustersV2Command({ ClusterTypeFilter: 'PROVISIONED', NextToken: cursor }),
        );
        return { items: r.ClusterInfoList ?? [], cursor: r.NextToken };
      });

      if (clusters.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const bytes = await mapWithConcurrency(clusters, CLOUDWATCH_CONCURRENCY, (cluster) =>
        this.sumBytes(cw, cluster.ClusterName!, startTime, endTime, periodSeconds),
      );

      const brokerTypes = [
        ...new Set(clusters.map((c) => c.Provisioned?.BrokerNodeGroupInfo?.InstanceType ?? 'unknown')),
      ];
      const priceEntries = await mapWithConcurrency(brokerTypes, CLOUDWATCH_CONCURRENCY, async (brokerType) => ({
        brokerType,
        price: (await this.pricing.getMskBrokerPricePerMonth(region, brokerType)) ?? 0,
      }));
      const priceByType = new Map(priceEntries.map((e) => [e.brokerType, e.price]));

      const now = new Date();
      const idle = clusters
        .map((cluster, index) => {
          const brokerInstanceType = cluster.Provisioned?.BrokerNodeGroupInfo?.InstanceType ?? 'unknown';
          const numberOfBrokerNodes = cluster.Provisioned?.NumberOfBrokerNodes ?? 1;
          const monthlyPrice = (priceByType.get(brokerInstanceType) ?? 0) * numberOfBrokerNodes;
          return new MskCluster({
            clusterName: cluster.ClusterName!,
            region,
            accountId: this.accountId,
            brokerInstanceType,
            numberOfBrokerNodes,
            bytesLastWindow: bytes[index],
            metricWindowHours: this.windowHours,
            creationTime: cluster.CreationTime ?? new Date(0),
            detectedAt: now,
            tags: cluster.Tags ?? {},
            monthlyCostUsd: +monthlyPrice.toFixed(4),
          });
        })
        .filter((cluster) => this.policy.evaluate(cluster, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('MSK', err as Error));
    } finally {
      kafka.destroy();
      cw.destroy();
    }
  }

  private async sumBytes(
    cw: CloudWatchClient,
    clusterName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const [bytesIn, bytesOut] = await Promise.all(
      ['BytesInPerSec', 'BytesOutPerSec'].map((metricName) =>
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/Kafka',
            MetricName: metricName,
            Dimensions: [{ Name: 'Cluster Name', Value: clusterName }],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: ['Sum'],
          }),
        ),
      ),
    );
    return (bytesIn.Datapoints?.[0]?.Sum ?? 0) + (bytesOut.Datapoints?.[0]?.Sum ?? 0);
  }
}
