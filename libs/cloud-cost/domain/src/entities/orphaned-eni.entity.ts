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
 * ENI con Status=available (non attaccata a nessuna istanza/ENI requester).
 * Costo marginale, spesso $0: AWS non fattura le ENI inattive di per sé, ma
 * accumulano limiti account e indicano automazione/cleanup mancante — è una
 * segnalazione di igiene, non un risparmio diretto.
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
