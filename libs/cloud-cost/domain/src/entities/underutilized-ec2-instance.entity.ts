import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * Istanza EC2 *running* con CPU massima sotto soglia sull'intera finestra di
 * osservazione: probabile sovradimensionamento. Advisory, non spreco certo —
 * CPU bassa non garantisce che RAM/rete siano altrettanto sottoutilizzate,
 * va verificato prima di un rightsizing (es. AWS Compute Optimizer).
 * `monthlyCostUsd` qui è il *risparmio* stimato da un downsize di un tier,
 * non il costo dell'istanza.
 */
export interface UnderutilizedEc2InstanceProps {
  instanceId: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
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
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get instanceType(): string { return this.props.instanceType; }
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
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.instanceType} underutilized — estimated rightsizing saving`,
    );
  }
}
