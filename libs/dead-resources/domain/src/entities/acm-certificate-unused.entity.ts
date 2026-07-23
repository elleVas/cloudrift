// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface AcmCertificateUnusedProps {
  certificateArn: string;
  domainName: string;
  region: AwsRegion;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * ACM certificate not attached to any AWS resource (`InUse === false` on
 * `ListCertificates`'s summary — the API computes this itself, no need to
 * cross-reference load balancers/CloudFront/etc. individually).
 * `ListCertificates` doesn't return tags inline, so `tags` is always `{}`.
 */
export class AcmCertificateUnused extends Entity<string> implements DeadResource {
  private readonly props: Readonly<AcmCertificateUnusedProps>;

  constructor(props: AcmCertificateUnusedProps) {
    super(props.certificateArn);
    this.props = this.deepFreeze({ ...props });
  }

  get domainName(): string {
    return this.props.domainName;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'acm-certificate-unused' {
    return 'acm-certificate-unused';
  }

  get hygieneReason(): string {
    return 'not in use by any AWS resource';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
