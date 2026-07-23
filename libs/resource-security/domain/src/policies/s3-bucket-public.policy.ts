// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { S3BucketPublic } from '../entities/s3-bucket-public.entity';

/** The scanner only emits buckets already confirmed public via ACL and/or policy. */
export class S3BucketPublicPolicy extends ResourceSecurityPolicy<S3BucketPublic> {
  protected judge(resource: S3BucketPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
