import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';

export interface NatGatewayProps {
  natGatewayId: string;
  region: AwsRegion;
  accountId: string;
  vpcId: string;
  createTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class NatGateway extends Entity<string> {
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
  get tags(): Record<string, string> { return this.props.tags; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'Idle NAT Gateway');
  }
}
