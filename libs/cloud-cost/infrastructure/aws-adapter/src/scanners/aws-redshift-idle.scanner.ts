// SPDX-License-Identifier: Apache-2.0
import { RedshiftClient, DescribeClustersCommand, type Cluster } from '@aws-sdk/client-redshift';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { RedshiftCluster, RedshiftIdleClusterPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * The price per node type is resolved on demand from the Pricing API (the
 * cardinality of node types is too high for the static price list/the
 * `warmUp` prefetch): `AwsPricingApiAdapter` satisfies this interface via
 * duck typing.
 */
export interface RedshiftNodePricingSource {
  getRedshiftNodePricePerMonth(region: AwsRegion, nodeType: string): Promise<number | undefined>;
}

/**
 * Detects Redshift clusters with zero database connections in the observed
 * window. Requires `--live-pricing`: without a price per node type, no
 * saving can be estimated.
 */
export class AwsRedshiftIdleScanner implements WasteScannerPort {
  readonly kind = 'redshift-idle-cluster' as const;

  constructor(
    private readonly pricing: RedshiftNodePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new RedshiftIdleClusterPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const redshift = new RedshiftClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const clusters = await paginate<Cluster>(async (cursor) => {
        const r = await redshift.send(new DescribeClustersCommand({ Marker: cursor }));
        return { items: r.Clusters ?? [], cursor: r.Marker };
      });

      if (clusters.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const connections = await mapWithConcurrency(clusters, CLOUDWATCH_CONCURRENCY, (cluster) =>
        this.sumConnections(cw, cluster.ClusterIdentifier!, startTime, endTime, periodSeconds),
      );

      const nodeTypes = [...new Set(clusters.map((c) => c.NodeType ?? 'unknown'))];
      const priceEntries = await mapWithConcurrency(nodeTypes, CLOUDWATCH_CONCURRENCY, async (nodeType) => ({
        nodeType,
        price: (await this.pricing.getRedshiftNodePricePerMonth(region, nodeType)) ?? 0,
      }));
      const priceByType = new Map(priceEntries.map((e) => [e.nodeType, e.price]));

      const now = new Date();
      const idle = clusters
        .map((cluster, index) => {
          const nodeType = cluster.NodeType ?? 'unknown';
          const numberOfNodes = cluster.NumberOfNodes ?? 1;
          const monthlyPrice = (priceByType.get(nodeType) ?? 0) * numberOfNodes;
          return new RedshiftCluster({
            clusterIdentifier: cluster.ClusterIdentifier!,
            region,
            accountId: this.accountId,
            nodeType,
            numberOfNodes,
            connectionsLastWindow: connections[index],
            metricWindowHours: this.windowHours,
            clusterCreateTime: cluster.ClusterCreateTime ?? new Date(0),
            detectedAt: now,
            tags: Object.fromEntries((cluster.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            monthlyCostUsd: +monthlyPrice.toFixed(4),
          });
        })
        .filter((cluster) => this.policy.evaluate(cluster, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Redshift', err as Error));
    } finally {
      redshift.destroy();
      cw.destroy();
    }
  }

  private async sumConnections(
    cw: CloudWatchClient,
    clusterIdentifier: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/Redshift',
        MetricName: 'DatabaseConnections',
        Dimensions: [{ Name: 'ClusterIdentifier', Value: clusterIdentifier }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
