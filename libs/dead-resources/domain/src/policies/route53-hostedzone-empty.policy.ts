// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, type HygieneVerdict } from './dead-resource-policy';
import type { Route53HostedZoneEmpty } from '../entities/route53-hostedzone-empty.entity';

/**
 * No grace-period machinery: `Route53HostedZoneEmpty` has no `createdAt`
 * (`ListHostedZones` doesn't expose one), same reasoning as
 * `Ec2SecurityGroupUnusedPolicy`.
 */
export class Route53HostedZoneEmptyPolicy extends DeadResourcePolicy<Route53HostedZoneEmpty> {
  protected judge(resource: Route53HostedZoneEmpty): HygieneVerdict {
    return flagged(resource.hygieneReason);
  }
}
