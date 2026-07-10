// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export type EbsVolumeState =
  | 'available'
  | 'in-use'
  | 'creating'
  | 'deleting'
  | 'deleted'
  | 'error';

export interface EbsVolumeProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  sizeGb: number;
  volumeType: string;
  state: EbsVolumeState;
  createTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class EbsVolume extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EbsVolumeProps>;

  constructor(props: EbsVolumeProps) {
    super(props.volumeId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeGb(): number { return this.props.sizeGb; }
  get volumeType(): string { return this.props.volumeType; }
  get state(): EbsVolumeState { return this.props.state; }
  get createTime(): Date { return this.props.createTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ebs-volume' { return 'ebs-volume'; }
  get wasteReason(): string { return 'unattached'; }

  isUnattached(): boolean {
    return this.props.state === 'available';
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB ${this.props.volumeType} unattached EBS`,
    );
  }
}
