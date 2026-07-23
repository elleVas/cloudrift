// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface S3BucketPublicProps {
  bucketName: string;
  accountId: string;
  /** e.g. ["bucket policy allows public access", "bucket ACL grants public access"]. */
  publicVia: string[];
  detectedAt: Date;
  tags: Record<string, string>;
}

/** S3 bucket reachable by the internet, via its ACL and/or bucket policy. S3 bucket names are account-wide (not per-region), so no `region`. */
export class S3BucketPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<S3BucketPublicProps>;

  constructor(props: S3BucketPublicProps) {
    super(props.bucketName);
    this.props = this.deepFreeze({ ...props });
  }

  get bucketName(): string {
    return this.props.bucketName;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get publicVia(): string[] {
    return this.props.publicVia;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 's3-bucket-public' {
    return 's3-bucket-public';
  }

  get riskReason(): string {
    return this.publicVia.join('; ');
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
