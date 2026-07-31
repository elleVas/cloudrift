// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { S3BucketVersioningDisabled } from '../entities/s3-bucket-versioning-disabled.entity';

/** The scanner only emits buckets that already fail one of the two conditions — always flagged once emitted. */
export class S3BucketVersioningDisabledPolicy extends ResourceSecurityPolicy<S3BucketVersioningDisabled> {
  protected judge(resource: S3BucketVersioningDisabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
