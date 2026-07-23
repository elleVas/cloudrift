// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict, type DeadResourcePolicyOptions } from './dead-resource-policy';
import type { Ec2RiExpiringSoon } from '../entities/ec2-ri-expiring-soon.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_EXPIRING_WITHIN_DAYS = 30;

/**
 * Doesn't use the base class's grace-period machinery (`minAgeDays`,
 * `isWithinGracePeriod`): that's "how long since this was created," the
 * opposite question from "how soon does this end" — an RI purchased years
 * ago is exactly the case this policy needs to flag. `expiringWithinDays` is
 * its own threshold, same pattern as e.g. `EbsIdlePolicy`'s extra
 * `maxOps` param beyond the shared options.
 */
export class Ec2RiExpiringSoonPolicy extends DeadResourcePolicy<Ec2RiExpiringSoon> {
  constructor(
    options: DeadResourcePolicyOptions = {},
    private readonly expiringWithinDays = DEFAULT_EXPIRING_WITHIN_DAYS,
  ) {
    super(options);
  }

  protected judge(resource: Ec2RiExpiringSoon, now: Date): HygieneVerdict {
    const daysUntilEnd = (resource.end.getTime() - now.getTime()) / MS_PER_DAY;
    if (daysUntilEnd > this.expiringWithinDays) {
      return notFlagged(`expires in more than ${this.expiringWithinDays}d`);
    }
    return flagged(resource.hygieneReason);
  }
}
