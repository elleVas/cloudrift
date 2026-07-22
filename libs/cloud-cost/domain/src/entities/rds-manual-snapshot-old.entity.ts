// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface RdsManualSnapshotOldProps {
  snapshotId: string;
  region: AwsRegion;
  accountId: string;
  sourceDbInstanceId: string;
  engine: string;
  allocatedStorageGb: number;
  snapshotCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class RdsManualSnapshotOld extends Entity<string> implements WastedResource {
  private readonly props: Readonly<RdsManualSnapshotOldProps>;

  constructor(props: RdsManualSnapshotOldProps) {
    super(props.snapshotId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sourceDbInstanceId(): string { return this.props.sourceDbInstanceId; }
  get engine(): string { return this.props.engine; }
  get allocatedStorageGb(): number { return this.props.allocatedStorageGb; }
  get snapshotCreateTime(): Date { return this.props.snapshotCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'rds-manual-snapshot-old' { return 'rds-manual-snapshot-old'; }
  get wasteReason(): string { return 'manual snapshot older than the grace period'; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `${this.props.allocatedStorageGb} GB manual snapshot`);
  }
}
