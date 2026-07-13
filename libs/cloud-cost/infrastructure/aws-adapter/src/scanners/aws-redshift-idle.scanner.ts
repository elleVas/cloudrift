// SPDX-License-Identifier: Apache-2.0
import { RedshiftClient, DescribeClustersCommand, type Cluster } from '@aws-sdk/client-redshift';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { RedshiftCluster, RedshiftIdleClusterPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface RedshiftNodePricingSource {
  getRedshiftNodePricePerMonth(region: AwsRegion, nodeType: string): Promise<number | undefined>;
}

type ClusterWithId = Cluster & { ClusterIdentifier: string };

export class AwsRedshiftIdleScanner extends CloudWatchIdleScanner<RedshiftClient, ClusterWithId, number, RedshiftCluster> {
  readonly kind = 'redshift-idle-cluster' as const;
  protected readonly serviceLabel = 'Redshift';

  constructor(
    private readonly pricing: RedshiftNodePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<RedshiftCluster> = new RedshiftIdleClusterPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): RedshiftClient {
    return new RedshiftClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: RedshiftClient): void {
    client.destroy();
  }

  protected async listResources(client: RedshiftClient): Promise<ClusterWithId[]> {
    const clusters = await paginate<Cluster>(async (cursor) => {
      const r = await client.send(new DescribeClustersCommand({ Marker: cursor }));
      return { items: r.Clusters ?? [], cursor: r.Marker };
    });
    const valid = clusters.filter((c): c is ClusterWithId => !!c.ClusterIdentifier);
    if (valid.length !== clusters.length) {
      logger.debug(`${this.kind}: skipped ${clusters.length - valid.length} entries missing ClusterIdentifier`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, cluster: ClusterWithId, window: MetricWindow) {
    return sumMetric(
      cw,
      'AWS/Redshift',
      'DatabaseConnections',
      [{ Name: 'ClusterIdentifier', Value: cluster.ClusterIdentifier }],
      window,
    );
  }

  protected override async resolvePrices(raw: ClusterWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const nodeTypes = [...new Set(raw.map((c) => c.NodeType ?? 'unknown'))];
    const entries = await mapWithConcurrency(nodeTypes, PRICING_CONCURRENCY, async (nodeType) => ({
      nodeType,
      price: (await this.pricing.getRedshiftNodePricePerMonth(region, nodeType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.nodeType, e.price]));
  }

  protected toEntity(
    cluster: ClusterWithId,
    connectionsLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): RedshiftCluster {
    const nodeType = cluster.NodeType ?? 'unknown';
    const numberOfNodes = cluster.NumberOfNodes ?? 1;
    const monthlyPrice = (prices.get(nodeType) ?? 0) * numberOfNodes;
    return new RedshiftCluster({
      clusterIdentifier: cluster.ClusterIdentifier,
      region,
      accountId: this.accountId,
      nodeType,
      numberOfNodes,
      connectionsLastWindow,
      metricWindowHours: this.windowHours,
      clusterCreateTime: cluster.ClusterCreateTime ?? new Date(0),
      detectedAt: now,
      tags: Object.fromEntries((cluster.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +monthlyPrice.toFixed(4),
    });
  }
}
