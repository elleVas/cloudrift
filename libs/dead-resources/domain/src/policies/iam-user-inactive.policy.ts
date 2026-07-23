// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict, type DeadResourcePolicyOptions } from './dead-resource-policy';
import type { IamUserInactive } from '../entities/iam-user-inactive.entity';

/** CIS AWS Foundations Benchmark's own threshold for "unused credentials should be disabled". */
export const DEFAULT_INACTIVITY_DAYS = 90;

export class IamUserInactivePolicy extends DeadResourcePolicy<IamUserInactive> {
  constructor(
    options: DeadResourcePolicyOptions = {},
    private readonly inactivityDays = DEFAULT_INACTIVITY_DAYS,
  ) {
    super(options);
  }

  protected judge(resource: IamUserInactive, now: Date): HygieneVerdict {
    // Grace period is measured from account creation — a brand new user
    // hasn't had time to log in yet regardless of activity data.
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    // lastActivityAt undefined means never used — measure idleness from
    // creation instead (equivalent to "idle since day one").
    const referenceDate = resource.lastActivityAt ?? resource.createdAt;
    if (this.ageInDays(referenceDate, now) < this.inactivityDays) {
      return notFlagged(`active within the last ${this.inactivityDays}d`);
    }
    return flagged(resource.hygieneReason);
  }
}
