// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { S3BucketEncryptionMissing } from '../entities/s3-bucket-encryption-missing.entity';

/** The scanner only emits buckets already confirmed to have no default encryption. */
export class S3BucketEncryptionMissingPolicy extends ResourceSecurityPolicy<S3BucketEncryptionMissing> {
  protected judge(resource: S3BucketEncryptionMissing): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
