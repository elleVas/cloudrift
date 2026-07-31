// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { S3AccountPublicAccessBlockDisabled } from '../entities/s3-account-public-access-block-disabled.entity';

/** The scanner only emits a finding when the account-level block isn't fully enabled — always flagged once emitted. */
export class S3AccountPublicAccessBlockDisabledPolicy extends ResourceSecurityPolicy<S3AccountPublicAccessBlockDisabled> {
  protected judge(resource: S3AccountPublicAccessBlockDisabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
