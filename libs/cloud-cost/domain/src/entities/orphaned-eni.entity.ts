import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface OrphanedEniProps {
  networkInterfaceId: string;
  region: AwsRegion;
  accountId: string;
  vpcId: string;
  subnetId: string;
  status: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * ENI with Status=available (not attached to any instance/ENI requester).
 * Marginal cost, often $0: AWS does not bill inactive ENIs per se, but
 * they accumulate against account limits and indicate missing automation/cleanup — it's a
 * hygiene flag, not a direct saving.
 */
export class OrphanedEni extends Entity<string> implements WastedResource {
  private readonly props: Readonly<OrphanedEniProps>;

  constructor(props: OrphanedEniProps) {
    super(props.networkInterfaceId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get vpcId(): string { return this.props.vpcId; }
  get subnetId(): string { return this.props.subnetId; }
  get status(): string { return this.props.status; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'eni-orphaned' { return 'eni-orphaned'; }
  get wasteReason(): string { return 'orphaned (not attached)'; }

  isOrphaned(): boolean {
    return this.props.status === 'available';
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(0, 'Orphaned ENI (hygiene flag, no direct cost)');
  }
}
