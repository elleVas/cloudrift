// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface AcmCertificateExpiringProps {
  certificateArn: string;
  domainName: string;
  notAfter: Date;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Issued ACM certificate approaching its expiry date. Distinct from
 * `dead-resources-domain`'s `acm-certificate-unused` (unreferenced, not
 * expiring): this one is actively in use but about to stop being valid.
 */
export class AcmCertificateExpiring extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<AcmCertificateExpiringProps>;

  constructor(props: AcmCertificateExpiringProps) {
    super(props.certificateArn);
    this.props = this.deepFreeze({ ...props });
  }

  get certificateArn(): string {
    return this.props.certificateArn;
  }

  get domainName(): string {
    return this.props.domainName;
  }

  get notAfter(): Date {
    return this.props.notAfter;
  }

  get region(): AwsRegion {
    return this.props.region;
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

  get kind(): 'acm-certificate-expiring' {
    return 'acm-certificate-expiring';
  }

  get riskReason(): string {
    const daysLeft = Math.ceil((this.notAfter.getTime() - this.detectedAt.getTime()) / (24 * 60 * 60 * 1000));
    return daysLeft < 0 ? `expired ${Math.abs(daysLeft)}d ago` : `expires in ${daysLeft}d`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
