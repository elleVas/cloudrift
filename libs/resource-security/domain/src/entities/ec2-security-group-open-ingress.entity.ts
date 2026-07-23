// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface Ec2SecurityGroupOpenIngressProps {
  groupId: string;
  groupName: string;
  region: AwsRegion;
  accountId: string;
  /** e.g. ["22/tcp from 0.0.0.0/0", "3389/tcp from ::/0"] — one per matched sensitive-port rule. */
  matchedRules: string[];
  detectedAt: Date;
  tags: Record<string, string>;
}

/** EC2 security group with an ingress rule open to the internet (0.0.0.0/0 or ::/0) on a commonly-attacked port (SSH, RDP, database ports). */
export class Ec2SecurityGroupOpenIngress extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<Ec2SecurityGroupOpenIngressProps>;

  constructor(props: Ec2SecurityGroupOpenIngressProps) {
    super(props.groupId);
    this.props = this.deepFreeze({ ...props });
  }

  get groupName(): string {
    return this.props.groupName;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get matchedRules(): string[] {
    return this.props.matchedRules;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'ec2-security-group-open-ingress' {
    return 'ec2-security-group-open-ingress';
  }

  get riskReason(): string {
    return `open ingress on sensitive port(s): ${this.matchedRules.join(', ')}`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
