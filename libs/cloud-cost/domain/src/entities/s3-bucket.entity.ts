import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface S3BucketProps {
  bucketName: string;
  region: AwsRegion;
  accountId: string;
  sizeBytes: number;
  hasLifecyclePolicy: boolean;
  creationDate: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  /** Heuristic estimate of the monthly saving from enabling a lifecycle policy. */
  monthlyCostUsd: number;
}

/**
 * S3 bucket with no lifecycle policy configured. Category
 * `optimization` + `estimated: true`: we don't know how much of the data is
 * actually "cold", so the saving is a heuristic estimate to verify,
 * not a definite value as for `ebs-gp2-upgrade`.
 */
export class S3Bucket extends Entity<string> implements WastedResource {
  private readonly props: Readonly<S3BucketProps>;

  constructor(props: S3BucketProps) {
    super(props.bucketName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeBytes(): number { return this.props.sizeBytes; }
  get creationDate(): Date { return this.props.creationDate; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 's3-no-lifecycle' { return 's3-no-lifecycle'; }
  get wasteReason(): string { return 'no lifecycle policy configured'; }

  hasLifecyclePolicy(): boolean {
    return this.props.hasLifecyclePolicy;
  }

  get costEstimate(): CostEstimate {
    const sizeGb = (this.props.sizeBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${sizeGb} GB without lifecycle policy (estimated saving)`,
    );
  }
}
