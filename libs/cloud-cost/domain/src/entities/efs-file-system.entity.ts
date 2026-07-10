// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface EfsFileSystemProps {
  fileSystemId: string;
  region: AwsRegion;
  accountId: string;
  sizeBytes: number;
  numberOfMountTargets: number;
  /** Sum of DataReadIOBytes + DataWriteIOBytes over the observation window. */
  ioBytesLastWindow: number;
  metricWindowHours: number;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class EfsFileSystem extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EfsFileSystemProps>;

  constructor(props: EfsFileSystemProps) {
    super(props.fileSystemId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeBytes(): number { return this.props.sizeBytes; }
  get numberOfMountTargets(): number { return this.props.numberOfMountTargets; }
  get ioBytesLastWindow(): number { return this.props.ioBytesLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'efs-unused' { return 'efs-unused'; }
  get wasteReason(): string {
    return this.hasNoMountTargets()
      ? 'no mount targets'
      : `zero I/O in last ${this.props.metricWindowHours}h`;
  }

  hasNoMountTargets(): boolean {
    return this.props.numberOfMountTargets === 0;
  }

  get costEstimate(): CostEstimate {
    const sizeGb = (this.props.sizeBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(this.props.monthlyCostUsd, `${sizeGb} GB EFS (${this.wasteReason})`);
  }
}
