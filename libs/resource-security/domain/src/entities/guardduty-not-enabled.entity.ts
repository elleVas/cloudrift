// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface GuarddutyNotEnabledProps {
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** No GuardDuty detector exists in this region (`ListDetectors` returns no `DetectorIds`). One finding per region, not per resource. */
export class GuarddutyNotEnabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<GuarddutyNotEnabledProps>;

  constructor(props: GuarddutyNotEnabledProps) {
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

  get kind(): 'guardduty-not-enabled' {
    return 'guardduty-not-enabled';
  }

  get riskReason(): string {
    return `no GuardDuty detector is enabled in ${this.region.code}`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
