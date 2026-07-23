// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, type HygieneVerdict } from './dead-resource-policy';
import type { Ec2SecurityGroupUnused } from '../entities/ec2-security-group-unused.entity';

/**
 * No grace-period machinery: `Ec2SecurityGroupUnused` has no `createdAt`
 * (`DescribeSecurityGroups` doesn't expose one). The scanner has already
 * done the real filtering (unreferenced by any ENI, not the `default`
 * group) — this policy only applies the shared tag exclusions from
 * `evaluate()` before flagging.
 */
export class Ec2SecurityGroupUnusedPolicy extends DeadResourcePolicy<Ec2SecurityGroupUnused> {
  protected judge(resource: Ec2SecurityGroupUnused): HygieneVerdict {
    return flagged(resource.hygieneReason);
  }
}
