// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * EBS volume *attached* (in-use) but with zero (or near-zero) I/O over the
 * observed window: you pay for the storage of a disk that does no work. It's full-cost
 * waste, distinct from `ebs-volume` (unattached volumes, state=available).
 */
export interface IdleEbsVolumeProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  sizeGb: number;
  volumeType: string;
  attachedInstanceId?: string;
  /** Sum of read operations in the window. */
  readOps: number;
  /** Sum of write operations in the window. */
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
