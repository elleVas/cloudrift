// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface VpcFlowLogsDisabledProps {
  vpcId: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** VPC with no active Flow Log (CIS AWS Foundations 3.9). */
export class VpcFlowLogsDisabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<VpcFlowLogsDisabledProps>;

  constructor(props: VpcFlowLogsDisabledProps) {
    super(props.vpcId);
    this.props = this.deepFreeze({ ...props });
  }

  get vpcId(): string {
    return this.props.vpcId;
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

  get kind(): 'vpc-flow-logs-disabled' {
    return 'vpc-flow-logs-disabled';
  }

  get riskReason(): string {
    return 'no active VPC Flow Log is configured for this VPC';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
