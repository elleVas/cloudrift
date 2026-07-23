// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface S3BucketEmptyProps {
  bucketName: string;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * S3 bucket with zero objects (`ListObjectsV2` with `MaxKeys: 1` returning
 * `KeyCount === 0`). `ListBuckets` is a single account-wide call regardless
 * of region, so this kind's scanner runs once (`scope: 'global'`) even
 * though each bucket itself lives in a specific region — no `region` field
 * here to avoid an extra `GetBucketLocation` call per bucket just to report
 * it (ADR-0078's reasoning for omitting `region` on global-scope kinds).
 * `ListBuckets` doesn't return tags, so `tags` is always `{}`.
 */
export class S3BucketEmpty extends Entity<string> implements DeadResource {
  private readonly props: Readonly<S3BucketEmptyProps>;

  constructor(props: S3BucketEmptyProps) {
    super(props.bucketName);
    this.props = this.deepFreeze({ ...props });
  }

  get bucketName(): string {
    return this.props.bucketName;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 's3-bucket-empty' {
    return 's3-bucket-empty';
  }

  get hygieneReason(): string {
    return 'contains no objects';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
