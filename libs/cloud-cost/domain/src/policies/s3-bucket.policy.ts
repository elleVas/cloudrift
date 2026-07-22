// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { S3Bucket } from '../entities/s3-bucket.entity';

export class S3NoLifecyclePolicy extends WastePolicy<S3Bucket> {
  protected judge(bucket: S3Bucket, now: Date): WasteVerdict {
    if (bucket.hasLifecyclePolicy()) return notWaste('lifecycle policy configured');
    if (this.isWithinGracePeriod(bucket.creationDate, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no lifecycle policy');
  }
}
