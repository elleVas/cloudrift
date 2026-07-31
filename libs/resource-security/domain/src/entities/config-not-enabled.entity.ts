// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface ConfigNotEnabledProps {
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** No AWS Config recorder is actively recording in this region. One finding per region, not per resource. */
export class ConfigNotEnabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<ConfigNotEnabledProps>;

  constructor(props: ConfigNotEnabledProps) {
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

  get kind(): 'config-not-enabled' {
    return 'config-not-enabled';
  }

  get riskReason(): string {
    return `no AWS Config recorder is actively recording in ${this.region.code}`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
