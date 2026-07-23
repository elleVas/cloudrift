// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface Route53HostedZoneEmptyProps {
  hostedZoneId: string;
  name: string;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Route53 hosted zone with no records beyond the default NS/SOA pair
 * (`ResourceRecordSetCount <= 2`, returned inline by `ListHostedZones` — no
 * per-zone `ListResourceRecordSets` call needed). No `createdAt`:
 * `ListHostedZones` doesn't expose a creation timestamp, so this kind's
 * policy skips the shared grace-period machinery, same reasoning as
 * `Ec2SecurityGroupUnused`. Route53 is a global AWS service — no `region`
 * (ADR-0078).
 */
export class Route53HostedZoneEmpty extends Entity<string> implements DeadResource {
  private readonly props: Readonly<Route53HostedZoneEmptyProps>;

  constructor(props: Route53HostedZoneEmptyProps) {
    super(props.hostedZoneId);
    this.props = this.deepFreeze({ ...props });
  }

  get name(): string {
    return this.props.name;
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

  get kind(): 'route53-hostedzone-empty' {
    return 'route53-hostedzone-empty';
  }

  get hygieneReason(): string {
    return 'contains no records beyond the default NS/SOA';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
