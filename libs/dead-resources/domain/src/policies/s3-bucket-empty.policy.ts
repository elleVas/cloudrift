// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { S3BucketEmpty } from '../entities/s3-bucket-empty.entity';

export class S3BucketEmptyPolicy extends DeadResourcePolicy<S3BucketEmpty> {
  protected judge(resource: S3BucketEmpty, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
