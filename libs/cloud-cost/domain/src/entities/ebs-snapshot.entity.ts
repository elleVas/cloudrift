// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface EbsSnapshotProps {
  snapshotId: string;
  region: AwsRegion;
  accountId: string;
  sourceVolumeId: string;
  /** False if the source volume no longer exists (orphaned snapshot). */
  sourceVolumeExists: boolean;
  /** Registered AMI that references the snapshot: if present, it is not deletable. */
  boundToAmiId?: string;
  sizeGb: number;
  startTime: Date;
  detectedAt: Date;
  description: string;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class EbsSnapshot extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EbsSnapshotProps>;

  constructor(props: EbsSnapshotProps) {
    super(props.snapshotId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sourceVolumeId(): string { return this.props.sourceVolumeId; }
  get sourceVolumeExists(): boolean { return this.props.sourceVolumeExists; }
  get boundToAmiId(): string | undefined { return this.props.boundToAmiId; }
  get sizeGb(): number { return this.props.sizeGb; }
  get startTime(): Date { return this.props.startTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get description(): string { return this.props.description; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ebs-snapshot' { return 'ebs-snapshot'; }
  get wasteReason(): string { return 'source volume deleted'; }

  isOrphan(): boolean {
    return !this.props.sourceVolumeExists;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB orphan snapshot`,
    );
  }
}
