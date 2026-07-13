// SPDX-License-Identifier: Apache-2.0
import { KafkaClient, ListClustersV2Command, type Cluster } from '@aws-sdk/client-kafka';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { MskCluster, MskIdleClusterPolicy, type WastePolicy } from 'cloud-cost-domain';
import { createAwsClientConfig } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface MskBrokerPricingSource {
  getMskBrokerPricePerMonth(region: AwsRegion, brokerInstanceType: string): Promise<number | undefined>;
}

type ClusterWithName = Cluster & { ClusterName: string };

/**
 * Detects MSK Provisioned clusters (Serverless bills per use, out of scope
 * per ADR-0038) with zero broker traffic in the observed window. Requires
 * `--live-pricing`: without a price per broker instance type, no saving
 * can be estimated.
 */
export class AwsMskIdleScanner extends CloudWatchIdleScanner<KafkaClient, ClusterWithName, number, MskCluster> {
  readonly kind = 'msk-idle-cluster' as const;
  protected readonly serviceLabel = 'MSK';

  constructor(
    private readonly pricing: MskBrokerPricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<MskCluster> = new MskIdleClusterPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): KafkaClient {
    return new KafkaClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: KafkaClient): void {
    client.destroy();
  }

  protected async listResources(client: KafkaClient): Promise<ClusterWithName[]> {
    const clusters = await paginate<Cluster>(async (cursor) => {
      const r = await client.send(
        new ListClustersV2Command({ ClusterTypeFilter: 'PROVISIONED', NextToken: cursor }),
      );
      return { items: r.ClusterInfoList ?? [], cursor: r.NextToken };
    });
    const valid = clusters.filter((c): c is ClusterWithName => !!c.ClusterName);
    if (valid.length !== clusters.length) {
      logger.debug(`${this.kind}: skipped ${clusters.length - valid.length} entries missing ClusterName`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, cluster: ClusterWithName, window: MetricWindow) {
    return sumMetrics(
      cw,
      'AWS/Kafka',
      ['BytesInPerSec', 'BytesOutPerSec'],
      [{ Name: 'Cluster Name', Value: cluster.ClusterName }],
      window,
    );
  }

  protected override async resolvePrices(raw: ClusterWithName[], region: AwsRegion): Promise<Map<string, number>> {
    const brokerTypes = [
      ...new Set(raw.map((c) => c.Provisioned?.BrokerNodeGroupInfo?.InstanceType ?? 'unknown')),
    ];
    const entries = await mapWithConcurrency(brokerTypes, PRICING_CONCURRENCY, async (brokerType) => ({
      brokerType,
      price: (await this.pricing.getMskBrokerPricePerMonth(region, brokerType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.brokerType, e.price]));
  }

  protected toEntity(
    cluster: ClusterWithName,
    bytesLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): MskCluster {
    const brokerInstanceType = cluster.Provisioned?.BrokerNodeGroupInfo?.InstanceType ?? 'unknown';
    const numberOfBrokerNodes = cluster.Provisioned?.NumberOfBrokerNodes ?? 1;
    const monthlyPrice = (prices.get(brokerInstanceType) ?? 0) * numberOfBrokerNodes;
    return new MskCluster({
      clusterName: cluster.ClusterName,
      region,
      accountId: this.accountId,
      brokerInstanceType,
      numberOfBrokerNodes,
      bytesLastWindow,
      metricWindowHours: this.windowHours,
      creationTime: cluster.CreationTime ?? new Date(0),
      detectedAt: now,
      tags: cluster.Tags ?? {},
      monthlyCostUsd: +monthlyPrice.toFixed(4),
    });
  }
}
