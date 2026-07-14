// SPDX-License-Identifier: Apache-2.0
import { RDSClient, DescribeDBClustersCommand, type DBCluster } from '@aws-sdk/client-rds';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WastePolicy } from 'cloud-cost-domain';
import { AuroraServerlessOverprovisioned, AuroraServerlessOverprovisionedPolicy } from 'cloud-cost-domain';
import { createAwsClientConfig } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { getMetricDatapoint, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

interface AcuMetric {
  peakAcu: number;
  /** false when CloudWatch returned no datapoint at all — see the entity doc. */
  hasDatapoint: boolean;
}

// Rightsizing signal — a longer window than the "zero-activity" scanners, so
// a rare weekly peak isn't mistaken for an idle floor (same reasoning as the
// CPU-underutilized scanners).
const DEFAULT_LOOKBACK_HOURS = 168;
const METRIC_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

type ServerlessV2Cluster = DBCluster & {
  DBClusterIdentifier: string;
  ServerlessV2ScalingConfiguration: { MinCapacity: number; MaxCapacity?: number };
};

/**
 * Recommended Min ACU: the observed peak plus a 20% margin, rounded up to the
 * 0.5-ACU granularity AWS accepts, never below the 0.5 ACU floor.
 */
export function suggestMinAcu(peakAcu: number): number {
  const withMargin = peakAcu * 1.2;
  const roundedToHalf = Math.ceil(withMargin * 2) / 2;
  return Math.max(0.5, roundedToHalf);
}

/**
 * Detects Aurora Serverless v2 clusters whose configured Min ACU floor is far
 * above the real peak capacity (ServerlessDatabaseCapacity) observed over the
 * window. The floor is billed 730h/month at a single flat ACU-hour rate (no
 * per-type cardinality), so pricing is always-on (ADR-0037).
 */
export class AwsAuroraServerlessIdleScanner extends CloudWatchIdleScanner<
  RDSClient,
  ServerlessV2Cluster,
  AcuMetric,
  AuroraServerlessOverprovisioned
> {
  readonly kind = 'aurora-serverless-overprovisioned' as const;
  protected readonly serviceLabel = 'Aurora';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<AuroraServerlessOverprovisioned> = new AuroraServerlessOverprovisionedPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours, METRIC_CONCURRENCY);
  }

  protected createPrimaryClient(region: AwsRegion): RDSClient {
    return new RDSClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: RDSClient): void {
    client.destroy();
  }

  protected async listResources(client: RDSClient): Promise<ServerlessV2Cluster[]> {
    const clusters = await paginate<DBCluster>(async (cursor) => {
      const r = await client.send(new DescribeDBClustersCommand({ Marker: cursor }));
      return { items: r.DBClusters ?? [], cursor: r.Marker };
    });

    // Only Serverless v2 clusters have a Min ACU floor (v1 uses the legacy
    // ScalingConfigurationInfo; provisioned Aurora has neither).
    const serverlessV2 = clusters.filter(
      (c): c is ServerlessV2Cluster =>
        !!c.DBClusterIdentifier && typeof c.ServerlessV2ScalingConfiguration?.MinCapacity === 'number',
    );
    if (serverlessV2.length !== clusters.length) {
      logger.debug(
        `${this.kind}: skipped ${clusters.length - serverlessV2.length} non-Serverless-v2 (or unnamed) clusters`,
      );
    }
    return serverlessV2;
  }

  protected async fetchMetric(
    cw: CloudWatchClient,
    _region: AwsRegion,
    c: ServerlessV2Cluster,
    window: MetricWindow,
  ): Promise<AcuMetric> {
    const dp = await getMetricDatapoint(
      cw,
      'AWS/RDS',
      'ServerlessDatabaseCapacity',
      [{ Name: 'DBClusterIdentifier', Value: c.DBClusterIdentifier }],
      window,
      ['Maximum'],
    );
    return { peakAcu: dp.Maximum ?? 0, hasDatapoint: dp.Maximum !== undefined };
  }

  protected toEntity(
    c: ServerlessV2Cluster,
    { peakAcu, hasDatapoint }: AcuMetric,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): AuroraServerlessOverprovisioned {
    const minAcu = c.ServerlessV2ScalingConfiguration.MinCapacity;
    const maxAcu = c.ServerlessV2ScalingConfiguration.MaxCapacity ?? minAcu;
    const suggestedMinAcu = suggestMinAcu(peakAcu);
    const acuMonthlyPrice = this.pricing.getPrice(region, 'aurora-acu');
    // Not gated on hasDatapoint: an entity is still built so the (notWaste)
    // policy verdict can be reasoned about; the policy itself refuses to
    // flag a missing datapoint as waste, so a bogus saving never surfaces.
    const monthlySavingsUsd = Math.max(0, minAcu - suggestedMinAcu) * acuMonthlyPrice;
    return new AuroraServerlessOverprovisioned({
      clusterIdentifier: c.DBClusterIdentifier,
      region,
      accountId: this.accountId,
      engine: c.Engine ?? 'aurora',
      minAcu,
      maxAcu,
      peakAcu,
      hasDatapoint,
      suggestedMinAcu,
      windowHours: this.windowHours,
      clusterCreateTime: c.ClusterCreateTime ?? new Date(0),
      detectedAt: now,
      tags: Object.fromEntries((c.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +monthlySavingsUsd.toFixed(4),
    });
  }
}
