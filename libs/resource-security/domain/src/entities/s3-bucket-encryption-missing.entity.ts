// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface S3BucketEncryptionMissingProps {
  bucketName: string;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** S3 bucket with no default server-side encryption configured (`GetBucketEncryption` returns `ServerSideEncryptionConfigurationNotFoundError`). */
export class S3BucketEncryptionMissing extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<S3BucketEncryptionMissingProps>;

  constructor(props: S3BucketEncryptionMissingProps) {
    super(props.bucketName);
    this.props = this.deepFreeze({ ...props });
  }

  get bucketName(): string {
    return this.props.bucketName;
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

  get kind(): 's3-bucket-encryption-missing' {
    return 's3-bucket-encryption-missing';
  }

  get riskReason(): string {
    return 'bucket has no default server-side encryption configured';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
