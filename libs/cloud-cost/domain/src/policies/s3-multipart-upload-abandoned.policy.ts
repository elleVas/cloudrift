// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { S3MultipartUploadAbandoned } from '../entities/s3-multipart-upload-abandoned.entity';

export class S3MultipartUploadAbandonedPolicy extends WastePolicy<S3MultipartUploadAbandoned> {
  protected judge(upload: S3MultipartUploadAbandoned, now: Date): WasteVerdict {
    // Every upload the scanner sees is by definition incomplete (still
    // listed by ListMultipartUploads); we only apply the grace period so as
    // not to flag an upload still actively in progress.
    if (this.isWithinGracePeriod(upload.initiated, now)) {
      return notWaste(`initiated less than ${this.minAgeDays}d ago`);
    }
    return waste('incomplete multipart upload past the grace period');
  }
}
