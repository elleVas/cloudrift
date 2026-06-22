import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * RDS instance that is *available* with maximum CPU below threshold over the entire
 * observation window: likely oversized. Advisory, not definite waste —
 * low CPU does not guarantee storage I/O or connections are equally
 * underutilized, must be verified before a rightsizing.
 * `monthlyCostUsd` here is the *saving* estimated from a tier downsize,
 * not the cost of the instance.
 */
export interface RdsUnderutilizedInstanceProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  dbInstanceClass: string;
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
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get dbInstanceClass(): string { return this.props.dbInstanceClass; }
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
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.dbInstanceClass} ${this.props.engine} underutilized — estimated rightsizing saving`,
    );
  }
}
