import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface NatGatewayProps {
  natGatewayId: string;
  region: AwsRegion;
  accountId: string;
  vpcId: string;
  createTime: Date;
  detectedAt: Date;
  /** Bytes inviati verso la destinazione nella finestra di osservazione. */
  bytesOutLastWindow: number;
  /** Ampiezza della finestra di osservazione in ore. */
  metricWindowHours: number;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class NatGateway extends Entity<string> implements WastedResource {
  private readonly props: Readonly<NatGatewayProps>;

  constructor(props: NatGatewayProps) {
    super(props.natGatewayId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get vpcId(): string { return this.props.vpcId; }
  get createTime(): Date { return this.props.createTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get bytesOutLastWindow(): number { return this.props.bytesOutLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'nat-gateway' { return 'nat-gateway'; }
  get wasteReason(): string {
    return `zero traffic in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.bytesOutLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'Idle NAT Gateway');
  }
}
