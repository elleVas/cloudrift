// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface S3BucketVersioningDisabledProps {
  bucketName: string;
  accountId: string;
  /** Which of the two conditions this bucket was flagged for. */
  issue: 'versioning-disabled' | 'mfa-delete-disabled';
  detectedAt: Date;
  tags: Record<string, string>;
}

/** S3 bucket with versioning disabled, or versioning enabled but MFA Delete not required (CIS AWS Foundations 2.1.3/2.1.4). */
export class S3BucketVersioningDisabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<S3BucketVersioningDisabledProps>;

  constructor(props: S3BucketVersioningDisabledProps) {
    super(props.bucketName);
    this.props = this.deepFreeze({ ...props });
  }

  get bucketName(): string {
    return this.props.bucketName;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get issue(): 'versioning-disabled' | 'mfa-delete-disabled' {
    return this.props.issue;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 's3-bucket-versioning-disabled' {
    return 's3-bucket-versioning-disabled';
  }

  get riskReason(): string {
    return this.issue === 'versioning-disabled' ? 'bucket versioning is not enabled' : 'versioning is enabled but MFA Delete is not required';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
