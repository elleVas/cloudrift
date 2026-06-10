import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';

export interface ElasticIpProps {
  allocationId: string;
  publicIp: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  associationId?: string;
  instanceId?: string;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class ElasticIp extends Entity<string> {
  private readonly props: Readonly<ElasticIpProps>;

  constructor(props: ElasticIpProps) {
    super(props.allocationId);
    this.props = Object.freeze({ ...props });
  }

  get publicIp(): string { return this.props.publicIp; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get associationId(): string | undefined { return this.props.associationId; }
  get tags(): Record<string, string> { return this.props.tags; }

  isUnassociated(): boolean {
    return !this.props.associationId;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'Unassociated Elastic IP');
  }
}
