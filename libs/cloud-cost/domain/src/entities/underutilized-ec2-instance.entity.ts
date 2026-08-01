// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * EC2 instance that is *running* with maximum CPU below threshold over the entire
 * observation window: likely oversized. Advisory, not definite waste —
 * low CPU does not guarantee RAM/network are equally underutilized,
 * must be verified before a rightsizing (e.g. AWS Compute Optimizer).
 * `monthlyCostUsd` is a real price subtraction (current type's monthly price
 * minus one-size-down's), not a heuristic fraction: `recommendedInstanceType`
 * is set only when both prices resolved from the Pricing API and the smaller
 * type is actually cheaper. When it's `undefined` (no CloudWatch memory
 * signal to justify more than one step, unparseable type, already the
 * smallest tier, or the Pricing API has no price for the stepped-down type),
 * `monthlyCostUsd` is `0` rather than a guess.
 */
export interface UnderutilizedEc2InstanceProps {
  instanceId: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
  recommendedInstanceType?: string;
  avgCpuPercent: number;
  maxCpuPercent: number;
  windowDays: number;
  launchTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class UnderutilizedEc2Instance extends Entity<string> implements WastedResource {
  private readonly props: Readonly<UnderutilizedEc2InstanceProps>;

  constructor(props: UnderutilizedEc2InstanceProps) {
    super(props.instanceId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get instanceType(): string { return this.props.instanceType; }
  get recommendedInstanceType(): string | undefined { return this.props.recommendedInstanceType; }
  get avgCpuPercent(): number { return this.props.avgCpuPercent; }
  get maxCpuPercent(): number { return this.props.maxCpuPercent; }
  get windowDays(): number { return this.props.windowDays; }
  get launchTime(): Date { return this.props.launchTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ec2-underutilized' { return 'ec2-underutilized'; }

  get wasteReason(): string {
    return `CPU max ${this.props.maxCpuPercent.toFixed(1)}% avg ${this.props.avgCpuPercent.toFixed(1)}% over ${this.props.windowDays}d — verify RAM/network before rightsizing (see AWS Compute Optimizer)`;
  }

  get costEstimate(): CostEstimate {
    const description = this.props.recommendedInstanceType
      ? `${this.props.instanceType} → ${this.props.recommendedInstanceType} (one size down, real price difference)`
      : `${this.props.instanceType} underutilized — no derivable rightsizing price, verify manually`;
    return CostEstimate.of(this.props.monthlyCostUsd, description);
  }
}
