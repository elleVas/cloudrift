// SPDX-License-Identifier: Apache-2.0
import { ElastiCacheClient, DescribeCacheClustersCommand, type CacheCluster } from '@aws-sdk/client-elasticache';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { IdleElastiCacheCluster, ElastiCacheIdlePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface ElastiCacheNodePricingSource {
  getElastiCacheNodePricePerMonth(region: AwsRegion, cacheNodeType: string): Promise<number | undefined>;
}

type CacheClusterWithId = CacheCluster & { CacheClusterId: string };

export class AwsElastiCacheIdleScanner extends CloudWatchIdleScanner<
  ElastiCacheClient,
  CacheClusterWithId,
  number,
  IdleElastiCacheCluster
> {
  readonly kind = 'elasticache-idle' as const;
  protected readonly serviceLabel = 'ElastiCache';

  constructor(
    private readonly pricing: ElastiCacheNodePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<IdleElastiCacheCluster> = new ElastiCacheIdlePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): ElastiCacheClient {
    return new ElastiCacheClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: ElastiCacheClient): void {
    client.destroy();
  }

  protected async listResources(client: ElastiCacheClient): Promise<CacheClusterWithId[]> {
    const clusters = await paginate<CacheCluster>(async (cursor) => {
      const r = await client.send(new DescribeCacheClustersCommand({ Marker: cursor }));
      return { items: r.CacheClusters ?? [], cursor: r.Marker };
    });
    const valid = clusters.filter((c): c is CacheClusterWithId => !!c.CacheClusterId);
    if (valid.length !== clusters.length) {
      logger.debug(`${this.kind}: skipped ${clusters.length - valid.length} entries missing CacheClusterId`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, cluster: CacheClusterWithId, window: MetricWindow) {
    return sumMetric(
      cw,
      'AWS/ElastiCache',
      'CurrConnections',
      [{ Name: 'CacheClusterId', Value: cluster.CacheClusterId }],
      window,
    );
  }

  protected override async resolvePrices(raw: CacheClusterWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const nodeTypes = [...new Set(raw.map((c) => c.CacheNodeType ?? 'unknown'))];
    const entries = await mapWithConcurrency(nodeTypes, PRICING_CONCURRENCY, async (nodeType) => ({
      nodeType,
      price: (await this.pricing.getElastiCacheNodePricePerMonth(region, nodeType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.nodeType, e.price]));
  }

  protected toEntity(
    cluster: CacheClusterWithId,
    connectionsLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): IdleElastiCacheCluster {
    const cacheNodeType = cluster.CacheNodeType ?? 'unknown';
    const numCacheNodes = cluster.NumCacheNodes ?? 1;
    const monthlyPrice = (prices.get(cacheNodeType) ?? 0) * numCacheNodes;
    return new IdleElastiCacheCluster({
      cacheClusterId: cluster.CacheClusterId,
      region,
      accountId: this.accountId,
      cacheNodeType,
      numCacheNodes,
      connectionsLastWindow,
      metricWindowHours: this.windowHours,
      createTime: cluster.CacheClusterCreateTime ?? new Date(0),
      detectedAt: now,
      tags: {},
      monthlyCostUsd: +monthlyPrice.toFixed(4),
    });
  }
}
