// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface Ec2RiExpiringSoonProps {
  reservedInstancesId: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
  instanceCount: number;
  end: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Active EC2 Reserved Instance whose term ends within the policy's
 * `expiringWithinDays` window. Not "waste" or "unused" in the sense every
 * other kind in this domain is — a fully-utilized RI is exactly what it
 * should be — but a reminder that its discount is about to lapse and no
 * renewal/replacement has (as far as this scan can tell) happened yet.
 */
export class Ec2RiExpiringSoon extends Entity<string> implements DeadResource {
  private readonly props: Readonly<Ec2RiExpiringSoonProps>;

  constructor(props: Ec2RiExpiringSoonProps) {
    super(props.reservedInstancesId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get instanceType(): string {
    return this.props.instanceType;
  }

  get instanceCount(): number {
    return this.props.instanceCount;
  }

  get end(): Date {
    return this.props.end;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'ec2-ri-expiring-soon' {
    return 'ec2-ri-expiring-soon';
  }

  get hygieneReason(): string {
    return `expires ${this.end.toISOString().split('T')[0]}`;
  }

  get severity(): DeadResourceSeverity {
    return 'warning';
  }
}
