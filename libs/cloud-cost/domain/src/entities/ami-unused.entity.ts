// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface AmiUnusedProps {
  imageId: string;
  region: AwsRegion;
  accountId: string;
  name: string;
  creationDate: Date;
  detectedAt: Date;
  /** True if referenced by a running/stopped instance or a launch template's latest version. */
  inUse: boolean;
  totalSnapshotSizeGb: number;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class AmiUnused extends Entity<string> implements WastedResource {
  private readonly props: Readonly<AmiUnusedProps>;

  constructor(props: AmiUnusedProps) {
    super(props.imageId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get name(): string { return this.props.name; }
  get creationDate(): Date { return this.props.creationDate; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get totalSnapshotSizeGb(): number { return this.props.totalSnapshotSizeGb; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ami-unused' { return 'ami-unused'; }
  get wasteReason(): string { return 'not referenced by any instance or launch template'; }

  isUnused(): boolean {
    return !this.props.inUse;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.totalSnapshotSizeGb} GB backing snapshot(s)`,
    );
  }
}
