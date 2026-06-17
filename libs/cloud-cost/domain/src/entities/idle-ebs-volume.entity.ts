import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * Volume EBS *attaccato* (in-use) ma con zero (o quasi) I/O nella finestra
 * osservata: si paga lo storage di un disco che non lavora. È spreco a costo
 * pieno, distinto da `ebs-volume` (volumi non attaccati, state=available).
 */
export interface IdleEbsVolumeProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  sizeGb: number;
  volumeType: string;
  attachedInstanceId?: string;
  /** Somma delle operazioni di lettura nella finestra. */
  readOps: number;
  /** Somma delle operazioni di scrittura nella finestra. */
  writeOps: number;
  metricWindowHours: number;
  createTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class IdleEbsVolume extends Entity<string> implements WastedResource {
  private readonly props: Readonly<IdleEbsVolumeProps>;

  constructor(props: IdleEbsVolumeProps) {
    super(props.volumeId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeGb(): number { return this.props.sizeGb; }
  get volumeType(): string { return this.props.volumeType; }
  get attachedInstanceId(): string | undefined { return this.props.attachedInstanceId; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get createTime(): Date { return this.props.createTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ebs-idle' { return 'ebs-idle'; }

  get wasteReason(): string {
    return `attached but zero I/O over ${this.props.metricWindowHours}h — detach or delete`;
  }

  totalOps(): number {
    return this.props.readOps + this.props.writeOps;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB ${this.props.volumeType} idle EBS (no I/O)`,
    );
  }
}
