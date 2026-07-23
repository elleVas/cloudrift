// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface Ec2SecurityGroupUnusedProps {
  groupId: string;
  groupName: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * EC2 security group not referenced by any network interface's `Groups`
 * list. The scanner excludes the account/VPC's `default` security group —
 * AWS auto-creates one per VPC and it can't be deleted, only emptied of
 * rules. No `createdAt`: `DescribeSecurityGroups` doesn't expose a creation
 * timestamp, so this kind's policy skips the shared grace-period machinery
 * (see `Ec2SecurityGroupUnusedPolicy`).
 */
export class Ec2SecurityGroupUnused extends Entity<string> implements DeadResource {
  private readonly props: Readonly<Ec2SecurityGroupUnusedProps>;

  constructor(props: Ec2SecurityGroupUnusedProps) {
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

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'ec2-security-group-unused' {
    return 'ec2-security-group-unused';
  }

  get hygieneReason(): string {
    return 'not attached to any network interface';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
