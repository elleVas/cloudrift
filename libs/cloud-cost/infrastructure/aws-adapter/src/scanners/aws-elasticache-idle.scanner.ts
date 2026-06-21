import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
  type CacheCluster,
} from '@aws-sdk/client-elasticache';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { IdleElastiCacheCluster, ElastiCacheIdlePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Il prezzo per node type è risolto on-demand dalla Pricing API (la
 * cardinalità dei node type è troppo alta per il listino statico/il
 * prefetch di `warmUp`): `AwsPricingApiAdapter` soddisfa questa interfaccia
 * per duck typing.
 */
export interface ElastiCacheNodePricingSource {
  getElastiCacheNodePricePerMonth(region: AwsRegion, cacheNodeType: string): Promise<number | undefined>;
}

/**
 * Rileva cluster ElastiCache con zero connessioni client nella finestra
 * osservata. A differenza di Lambda, un nodo ElastiCache è fatturato per
 * ora indipendentemente dall'uso: zero connessioni è spreco reale, non solo
 * igiene. Richiede `--live-pricing`: senza un prezzo per node type, non c'è
 * risparmio stimabile.
 */
export class AwsElastiCacheIdleScanner implements WasteScannerPort {
  readonly kind = 'elasticache-idle' as const;

  constructor(
    private readonly pricing: ElastiCacheNodePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new ElastiCacheIdlePolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const elasticache = new ElastiCacheClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const rawClusters = await paginate<CacheCluster>(async (cursor) => {
        const r = await elasticache.send(new DescribeCacheClustersCommand({ Marker: cursor }));
        return { items: r.CacheClusters ?? [], cursor: r.Marker };
      });

      if (rawClusters.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const connections = await mapWithConcurrency(rawClusters, CLOUDWATCH_CONCURRENCY, (cluster) =>
        this.sumConnections(cw, cluster.CacheClusterId!, startTime, endTime, periodSeconds),
      );

      const nodeTypes = [...new Set(rawClusters.map((c) => c.CacheNodeType ?? 'unknown'))];
      const priceEntries = await mapWithConcurrency(nodeTypes, CLOUDWATCH_CONCURRENCY, async (nodeType) => ({
        nodeType,
        price: (await this.pricing.getElastiCacheNodePricePerMonth(region, nodeType)) ?? 0,
      }));
      const priceByType = new Map(priceEntries.map((e) => [e.nodeType, e.price]));

      const now = new Date();
      const clusters = rawClusters
        .map((cluster, index) => {
          const cacheNodeType = cluster.CacheNodeType ?? 'unknown';
          const numCacheNodes = cluster.NumCacheNodes ?? 1;
          const monthlyPrice = (priceByType.get(cacheNodeType) ?? 0) * numCacheNodes;
          return new IdleElastiCacheCluster({
            cacheClusterId: cluster.CacheClusterId!,
            region,
            accountId: this.accountId,
            cacheNodeType,
            numCacheNodes,
            connectionsLastWindow: connections[index],
            metricWindowHours: this.windowHours,
            createTime: cluster.CacheClusterCreateTime ?? new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +monthlyPrice.toFixed(4),
          });
        })
        .filter((cluster) => this.policy.evaluate(cluster, now).isWaste);

      return Result.ok(clusters);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ElastiCache', err as Error));
    } finally {
      elasticache.destroy();
      cw.destroy();
    }
  }

  private async sumConnections(
    cw: CloudWatchClient,
    cacheClusterId: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/ElastiCache',
        MetricName: 'CurrConnections',
        Dimensions: [{ Name: 'CacheClusterId', Value: cacheClusterId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
