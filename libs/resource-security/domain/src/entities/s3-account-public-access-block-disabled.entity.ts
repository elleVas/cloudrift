// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface S3AccountPublicAccessBlockDisabledProps {
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Account-wide S3 Block Public Access is not fully enabled (all four
 * settings true). Distinct from `s3-bucket-public` — that's a per-bucket
 * check for buckets that are actually reachable today; this is the
 * account-wide safety net that would prevent any bucket from becoming
 * public in the first place, even a newly created one.
 */
export class S3AccountPublicAccessBlockDisabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<S3AccountPublicAccessBlockDisabledProps>;

  constructor(props: S3AccountPublicAccessBlockDisabledProps) {
    super(props.accountId);
    this.props = this.deepFreeze({ ...props });
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 's3-account-public-access-block-disabled' {
    return 's3-account-public-access-block-disabled';
  }

  get riskReason(): string {
    return 'account-level S3 Block Public Access is not fully enabled';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
