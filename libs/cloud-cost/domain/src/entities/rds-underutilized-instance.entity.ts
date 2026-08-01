// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * RDS instance that is *available* with maximum CPU below threshold over the entire
 * observation window: likely oversized. Advisory, not definite waste —
 * low CPU does not guarantee storage I/O or connections are equally
 * underutilized, must be verified before a rightsizing.
 * `monthlyCostUsd` is a real price subtraction (current class's monthly
 * price minus one-size-down's), not a heuristic fraction:
 * `recommendedInstanceClass` is set only when both prices resolved from the
 * Pricing API and the smaller class is actually cheaper. When it's
 * `undefined`, `monthlyCostUsd` is `0` rather than a guess.
 */
export interface RdsUnderutilizedInstanceProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  dbInstanceClass: string;
  recommendedInstanceClass?: string;
  engine: string;
  avgCpuPercent: number;
  maxCpuPercent: number;
  windowDays: number;
  instanceCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class RdsUnderutilizedInstance extends Entity<string> implements WastedResource {
  private readonly props: Readonly<RdsUnderutilizedInstanceProps>;

  constructor(props: RdsUnderutilizedInstanceProps) {
    super(props.dbInstanceIdentifier);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get dbInstanceClass(): string { return this.props.dbInstanceClass; }
  get recommendedInstanceClass(): string | undefined { return this.props.recommendedInstanceClass; }
  get engine(): string { return this.props.engine; }
  get avgCpuPercent(): number { return this.props.avgCpuPercent; }
  get maxCpuPercent(): number { return this.props.maxCpuPercent; }
  get windowDays(): number { return this.props.windowDays; }
  get instanceCreateTime(): Date { return this.props.instanceCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'rds-underutilized' { return 'rds-underutilized'; }

  get wasteReason(): string {
    return `CPU max ${this.props.maxCpuPercent.toFixed(1)}% avg ${this.props.avgCpuPercent.toFixed(1)}% over ${this.props.windowDays}d — verify storage I/O and connections before rightsizing`;
  }

  get costEstimate(): CostEstimate {
    const description = this.props.recommendedInstanceClass
      ? `${this.props.dbInstanceClass} → ${this.props.recommendedInstanceClass} ${this.props.engine} (one size down, real price difference)`
      : `${this.props.dbInstanceClass} ${this.props.engine} underutilized — no derivable rightsizing price, verify manually`;
    return CostEstimate.of(this.props.monthlyCostUsd, description);
  }
}
