// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface S3MultipartUploadAbandonedProps {
  uploadId: string;
  region: AwsRegion;
  accountId: string;
  bucketName: string;
  key: string;
  uploadedBytes: number;
  initiated: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class S3MultipartUploadAbandoned extends Entity<string> implements WastedResource {
  private readonly props: Readonly<S3MultipartUploadAbandonedProps>;

  constructor(props: S3MultipartUploadAbandonedProps) {
    super(props.uploadId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get bucketName(): string { return this.props.bucketName; }
  get key(): string { return this.props.key; }
  get uploadedBytes(): number { return this.props.uploadedBytes; }
  get initiated(): Date { return this.props.initiated; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 's3-multipart-upload-abandoned' { return 's3-multipart-upload-abandoned'; }
  get wasteReason(): string { return 'incomplete multipart upload, never completed or aborted'; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${(this.props.uploadedBytes / 1024 ** 3).toFixed(2)} GB uploaded parts`,
    );
  }
}
