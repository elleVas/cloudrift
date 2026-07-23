// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict, type DeadResourcePolicyOptions } from './dead-resource-policy';
import type { IamRoleUnused } from '../entities/iam-role-unused.entity';

/** CIS AWS Foundations Benchmark's own threshold for "unused credentials should be disabled", reused here for role assumption. */
export const DEFAULT_ROLE_INACTIVITY_DAYS = 90;

export class IamRoleUnusedPolicy extends DeadResourcePolicy<IamRoleUnused> {
  constructor(
    options: DeadResourcePolicyOptions = {},
    private readonly inactivityDays = DEFAULT_ROLE_INACTIVITY_DAYS,
  ) {
    super(options);
  }

  protected judge(resource: IamRoleUnused, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    const referenceDate = resource.lastUsedAt ?? resource.createdAt;
    if (this.ageInDays(referenceDate, now) < this.inactivityDays) {
      return notFlagged(`assumed within the last ${this.inactivityDays}d`);
    }
    return flagged(resource.hygieneReason);
  }
}
