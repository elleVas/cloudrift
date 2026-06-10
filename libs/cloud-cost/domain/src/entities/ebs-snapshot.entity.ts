import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';

export interface EbsSnapshotProps {
  snapshotId: string;
  region: AwsRegion;
  accountId: string;
  sourceVolumeId: string;
  sizeGb: number;
  startTime: Date;
  detectedAt: Date;
  description: string;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class EbsSnapshot extends Entity<string> {
  private readonly props: Readonly<EbsSnapshotProps>;

  constructor(props: EbsSnapshotProps) {
    super(props.snapshotId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sourceVolumeId(): string { return this.props.sourceVolumeId; }
  get sizeGb(): number { return this.props.sizeGb; }
  get startTime(): Date { return this.props.startTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get description(): string { return this.props.description; }
  get tags(): Record<string, string> { return this.props.tags; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB orphan snapshot`,
    );
  }
}
