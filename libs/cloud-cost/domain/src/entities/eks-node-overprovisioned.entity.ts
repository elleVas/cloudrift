// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * EKS Node Group whose allocated capacity is far above what's actually
 * requested by scheduled Pods, per Container Insights' node-level
 * aggregates (`node_cpu_request`/`node_cpu_limit`). AWS-API-only, no
 * kubeconfig — see ADR-0066: this sees Node-group-level aggregates, never
 * individual Pod requests/limits.
 *
 * Advisory (`estimated`): `monthlyCostUsd` here is the potential *saving*
 * from scaling the group down to `suggestedNodeCount`, not the group's
 * current cost (same convention as {@link AuroraServerlessOverprovisioned}).
 */
export interface EksNodeOverprovisionedProps {
  clusterName: string;
  nodegroupName: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
  nodeCount: number;
  suggestedNodeCount: number;
  cpuAllocatableMillis: number;
  cpuRequestedMillis: number;
  memoryAllocatableBytes: number;
  memoryRequestedBytes: number;
  /**
   * Whether Container Insights actually returned a datapoint for the
   * window. `false` means "no evidence" (Container Insights likely not
   * enabled on the cluster) — the policy must not treat it as an idle floor.
   */
  hasDatapoint: boolean;
  windowHours: number;
  nodegroupCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class EksNodeOverprovisioned extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EksNodeOverprovisionedProps>;

  constructor(props: EksNodeOverprovisionedProps) {
    super(`${props.clusterName}/${props.nodegroupName}`);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get clusterName(): string { return this.props.clusterName; }
  get nodegroupName(): string { return this.props.nodegroupName; }
  get instanceType(): string { return this.props.instanceType; }
  get nodeCount(): number { return this.props.nodeCount; }
  get suggestedNodeCount(): number { return this.props.suggestedNodeCount; }
  get cpuAllocatableMillis(): number { return this.props.cpuAllocatableMillis; }
  get cpuRequestedMillis(): number { return this.props.cpuRequestedMillis; }
  get memoryAllocatableBytes(): number { return this.props.memoryAllocatableBytes; }
  get memoryRequestedBytes(): number { return this.props.memoryRequestedBytes; }
  get hasDatapoint(): boolean { return this.props.hasDatapoint; }
  get windowHours(): number { return this.props.windowHours; }
  get nodegroupCreateTime(): Date { return this.props.nodegroupCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'eks-node-overprovisioned' { return 'eks-node-overprovisioned'; }

  get cpuRequestedPercent(): number {
    return this.props.cpuAllocatableMillis > 0
      ? (this.props.cpuRequestedMillis / this.props.cpuAllocatableMillis) * 100
      : 0;
  }

  get wasteReason(): string {
    return `CPU requested ${this.cpuRequestedPercent.toFixed(1)}% of allocatable across ${this.props.nodeCount} node(s) over ${this.props.windowHours}h — Container Insights node-level aggregate, not Pod-level (ADR-0066)`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `EKS node group ${this.props.clusterName}/${this.props.nodegroupName} ${this.props.instanceType} ${this.props.nodeCount}→${this.props.suggestedNodeCount} nodes — estimated saving`,
    );
  }
}
