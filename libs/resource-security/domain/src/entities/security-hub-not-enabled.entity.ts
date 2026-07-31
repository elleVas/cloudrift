// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface SecurityHubNotEnabledProps {
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** Security Hub is not enabled in this region (`DescribeHub` fails with `InvalidAccessException`). One finding per region, not per resource. */
export class SecurityHubNotEnabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<SecurityHubNotEnabledProps>;

  constructor(props: SecurityHubNotEnabledProps) {
    super(`${props.accountId}:${props.region.code}`);
    this.props = this.deepFreeze({ ...props });
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

  get kind(): 'security-hub-not-enabled' {
    return 'security-hub-not-enabled';
  }

  get riskReason(): string {
    return `Security Hub is not enabled in ${this.region.code}`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
