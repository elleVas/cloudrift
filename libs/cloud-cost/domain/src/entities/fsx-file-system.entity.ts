// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface FsxFileSystemProps {
  fileSystemId: string;
  region: AwsRegion;
  accountId: string;
  fileSystemType: string;
  storageCapacityGiB: number;
  /** Sum of DataReadBytes + DataWriteBytes over the observation window. */
  ioBytesLastWindow: number;
  metricWindowHours: number;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class FsxFileSystem extends Entity<string> implements WastedResource {
  private readonly props: Readonly<FsxFileSystemProps>;

  constructor(props: FsxFileSystemProps) {
    super(props.fileSystemId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get fileSystemType(): string { return this.props.fileSystemType; }
  get storageCapacityGiB(): number { return this.props.storageCapacityGiB; }
  get ioBytesLastWindow(): number { return this.props.ioBytesLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'fsx-idle-filesystem' { return 'fsx-idle-filesystem'; }
  get wasteReason(): string {
    return `zero I/O in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.ioBytesLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.fileSystemType} FSx file system`);
  }
}
