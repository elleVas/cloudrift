// SPDX-License-Identifier: Apache-2.0
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
  /** Always 0 — see class doc. */
  monthlyCostUsd: number;
  wasteReason: string;
}

/**
 * S3 bucket with no lifecycle policy configured. Category `optimization` +
 * `estimated: true`, but `monthlyCostUsd` is always 0: unlike a CPU-based
 * rightsizing signal, there is no basis at all for a dollar figure here —
 * the saving depends entirely on the object-age distribution inside the
 * bucket, which cloudrift doesn't have (would need S3 Storage Lens or
 * Storage Class Analysis). This is a hygiene flag to verify, not a costed
 * finding, and deliberately reads $0 rather than a plausible-looking number.
 */
export class S3Bucket extends Entity<string> implements WastedResource {
  private readonly props: Readonly<S3BucketProps>;

  constructor(props: S3BucketProps) {
    super(props.bucketName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeBytes(): number { return this.props.sizeBytes; }
  get creationDate(): Date { return this.props.creationDate; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 's3-no-lifecycle' { return 's3-no-lifecycle'; }
  get wasteReason(): string { return this.props.wasteReason; }

  hasLifecyclePolicy(): boolean {
    return this.props.hasLifecyclePolicy;
  }

  get costEstimate(): CostEstimate {
    const sizeGb = (this.props.sizeBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${sizeGb} GB without lifecycle policy (no dollar estimate — depends on object age)`,
    );
  }
}
