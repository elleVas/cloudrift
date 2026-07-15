// SPDX-License-Identifier: Apache-2.0
import {
  EKSClient,
  ListClustersCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
  type Nodegroup,
} from '@aws-sdk/client-eks';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, WastePolicy } from 'cloud-cost-domain';
import { EksNodeOverprovisioned, EksNodeOverprovisionedPolicy } from 'cloud-cost-domain';
import { createAwsClientConfig } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { getMetricDatapoint, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

// Rightsizing signal — the longer window, same reasoning as Aurora/EC2/RDS
// underutilized scanners (a rare weekly peak shouldn't look like an idle floor).
const DEFAULT_LOOKBACK_HOURS = 168;
const LIST_CONCURRENCY = 5;
const PRICING_CONCURRENCY = 5;
// Target CPU-requested-to-allocatable ratio the suggested node count aims
// for — headroom above the "overprovisioned" alarm threshold so the
// suggestion isn't itself right at the edge.
const TARGET_CPU_UTILIZATION_PERCENT = 70;
const logger = createLogger('cloudrift:scanner');

export interface EksNodeInstancePricingSource {
  getEc2InstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

type ActiveNodegroup = Nodegroup & {
  clusterName: string;
  nodegroupName: string;
  instanceTypes: string[];
  scalingConfig: { desiredSize: number };
};

interface NodegroupUtilization {
  cpuAllocatableMillis: number;
  cpuRequestedMillis: number;
  memoryAllocatableBytes: number;
  memoryRequestedBytes: number;
  /** false when Container Insights returned no datapoint (likely not enabled). */
  hasDatapoint: boolean;
}

/**
 * Recommended node count: scale down until the CPU-requested-to-allocatable
 * ratio would reach {@link TARGET_CPU_UTILIZATION_PERCENT}, never below 1
 * node and never above the current count.
 */
export function suggestNodeCount(nodeCount: number, cpuRequestedPercent: number): number {
  if (nodeCount <= 0) return 0;
  const suggested = Math.ceil(nodeCount * (cpuRequestedPercent / TARGET_CPU_UTILIZATION_PERCENT));
  return Math.max(1, Math.min(nodeCount, suggested));
}

/**
 * Detects EKS Node Groups whose allocated capacity is far above what's
 * requested by scheduled Pods, per Container Insights' node-level
 * aggregates. AWS-API-only (ADR-0066): `eks:ListClusters` →
 * `eks:ListNodegroups` → `eks:DescribeNodegroup`, plus CloudWatch Container
 * Insights metrics. If Container Insights isn't enabled on a cluster, no
 * datapoint comes back and the policy refuses to flag it (graceful degrade,
 * same convention as {@link AwsAuroraServerlessIdleScanner}'s `hasDatapoint`).
 * Per-instance-type pricing, so gated on `--live-pricing` (ADR-0037).
 */
export class AwsEksNodeOverprovisionedScanner extends CloudWatchIdleScanner<
  EKSClient,
  ActiveNodegroup,
  NodegroupUtilization,
  EksNodeOverprovisioned
> {
  readonly kind = 'eks-node-overprovisioned' as const;
  protected readonly serviceLabel = 'EKS';

  constructor(
    private readonly pricing: EksNodeInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<EksNodeOverprovisioned> = new EksNodeOverprovisionedPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EKSClient {
    return new EKSClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: EKSClient): void {
    client.destroy();
  }

  protected async listResources(client: EKSClient): Promise<ActiveNodegroup[]> {
    const clusterNames = await paginate<string>(async (cursor) => {
      const r = await client.send(new ListClustersCommand({ nextToken: cursor }));
      return { items: r.clusters ?? [], cursor: r.nextToken };
    });

    const nodegroupRefs = (
      await mapWithConcurrency(clusterNames, LIST_CONCURRENCY, async (clusterName) => {
        const nodegroupNames = await paginate<string>(async (cursor) => {
          const r = await client.send(new ListNodegroupsCommand({ clusterName, nextToken: cursor }));
          return { items: r.nodegroups ?? [], cursor: r.nextToken };
        });
        return nodegroupNames.map((nodegroupName) => ({ clusterName, nodegroupName }));
      })
    ).flat();

    const nodegroups = await mapWithConcurrency(nodegroupRefs, LIST_CONCURRENCY, async ({ clusterName, nodegroupName }) => {
      const r = await client.send(new DescribeNodegroupCommand({ clusterName, nodegroupName }));
      return r.nodegroup;
    });

    const active = nodegroups.filter(
      (ng): ng is ActiveNodegroup =>
        !!ng &&
        ng.status === 'ACTIVE' &&
        !!ng.clusterName &&
        !!ng.nodegroupName &&
        Array.isArray(ng.instanceTypes) &&
        ng.instanceTypes.length > 0 &&
        typeof ng.scalingConfig?.desiredSize === 'number',
    );
    if (active.length !== nodegroups.length) {
      logger.debug(`${this.kind}: skipped ${nodegroups.length - active.length} non-ACTIVE (or incomplete) node groups`);
    }
    return active;
  }

  protected async fetchMetric(
    cw: CloudWatchClient,
    _region: AwsRegion,
    ng: ActiveNodegroup,
    window: MetricWindow,
  ): Promise<NodegroupUtilization> {
    const dimensions = [
      { Name: 'ClusterName', Value: ng.clusterName },
      { Name: 'NodegroupName', Value: ng.nodegroupName },
    ];
    const [cpuRequest, cpuLimit, memRequest, memLimit] = await Promise.all([
      getMetricDatapoint(cw, 'ContainerInsights', 'node_cpu_request', dimensions, window, ['Average']),
      getMetricDatapoint(cw, 'ContainerInsights', 'node_cpu_limit', dimensions, window, ['Average']),
      getMetricDatapoint(cw, 'ContainerInsights', 'node_memory_request', dimensions, window, ['Average']),
      getMetricDatapoint(cw, 'ContainerInsights', 'node_memory_limit', dimensions, window, ['Average']),
    ]);
    return {
      cpuRequestedMillis: cpuRequest.Average ?? 0,
      cpuAllocatableMillis: cpuLimit.Average ?? 0,
      memoryRequestedBytes: memRequest.Average ?? 0,
      memoryAllocatableBytes: memLimit.Average ?? 0,
      // node_cpu_limit missing is the reliable "Container Insights isn't
      // reporting for this node group" signal (allocatable capacity is
      // always non-zero once it IS reporting; request can legitimately be 0).
      hasDatapoint: cpuLimit.Average !== undefined,
    };
  }

  protected override async resolvePrices(raw: ActiveNodegroup[], region: AwsRegion): Promise<Map<string, number>> {
    const instanceTypes = [...new Set(raw.map((ng) => ng.instanceTypes[0] ?? 'unknown'))];
    const entries = await mapWithConcurrency(instanceTypes, PRICING_CONCURRENCY, async (instanceType) => ({
      instanceType,
      price: (await this.pricing.getEc2InstancePricePerMonth(region, instanceType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceType, e.price]));
  }

  protected toEntity(
    ng: ActiveNodegroup,
    metric: NodegroupUtilization,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): EksNodeOverprovisioned {
    const instanceType = ng.instanceTypes[0] ?? 'unknown';
    const nodeCount = ng.scalingConfig.desiredSize;
    const cpuRequestedPercent =
      metric.cpuAllocatableMillis > 0 ? (metric.cpuRequestedMillis / metric.cpuAllocatableMillis) * 100 : 0;
    const suggestedNodeCount = suggestNodeCount(nodeCount, cpuRequestedPercent);
    const instancePrice = prices.get(instanceType) ?? 0;
    // Not gated on hasDatapoint: an entity is still built so the (notWaste)
    // policy verdict can be reasoned about, same convention as Aurora.
    const monthlySavingsUsd = Math.max(0, nodeCount - suggestedNodeCount) * instancePrice;
    return new EksNodeOverprovisioned({
      clusterName: ng.clusterName,
      nodegroupName: ng.nodegroupName,
      region,
      accountId: this.accountId,
      instanceType,
      nodeCount,
      suggestedNodeCount,
      cpuAllocatableMillis: metric.cpuAllocatableMillis,
      cpuRequestedMillis: metric.cpuRequestedMillis,
      memoryAllocatableBytes: metric.memoryAllocatableBytes,
      memoryRequestedBytes: metric.memoryRequestedBytes,
      hasDatapoint: metric.hasDatapoint,
      windowHours: this.windowHours,
      nodegroupCreateTime: ng.createdAt ?? new Date(0),
      detectedAt: now,
      tags: ng.tags ?? {},
      monthlyCostUsd: +monthlySavingsUsd.toFixed(4),
    });
  }
}
