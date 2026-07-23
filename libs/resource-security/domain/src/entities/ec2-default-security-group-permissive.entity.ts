// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface Ec2DefaultSecurityGroupPermissiveProps {
  groupId: string;
  vpcId: string;
  region: AwsRegion;
  accountId: string;
  hasIngressRules: boolean;
  hasEgressRules: boolean;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * A VPC's auto-created `default` security group still carries ingress
 * and/or egress rules. CIS AWS Foundations 5.3 recommends the default
 * security group of every VPC restrict all traffic — it can't be deleted,
 * only emptied, and is silently attached to any resource launched without
 * an explicit security group.
 */
export class Ec2DefaultSecurityGroupPermissive extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<Ec2DefaultSecurityGroupPermissiveProps>;

  constructor(props: Ec2DefaultSecurityGroupPermissiveProps) {
    super(props.groupId);
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

  get hasIngressRules(): boolean {
    return this.props.hasIngressRules;
  }

  get hasEgressRules(): boolean {
    return this.props.hasEgressRules;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'ec2-default-security-group-permissive' {
    return 'ec2-default-security-group-permissive';
  }

  get riskReason(): string {
    const parts: string[] = [];
    if (this.hasIngressRules) parts.push('ingress rules present');
    if (this.hasEgressRules) parts.push('egress rules present');
    return `default security group should restrict all traffic (${parts.join(', ')})`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
