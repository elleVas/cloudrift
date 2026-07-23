// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict, type DeadResourcePolicyOptions } from './dead-resource-policy';
import type { IamAccessKeyStale } from '../entities/iam-access-key-stale.entity';

/** CIS AWS Foundations Benchmark's own rotation threshold — the standard 7-day `DEFAULT_MIN_AGE_DAYS` grace period is too short to mean "stale" for a credential. */
export const DEFAULT_ACCESS_KEY_MAX_AGE_DAYS = 90;

/**
 * Grace-period-only judgment (same shape as `Ec2KeyPairUnusedPolicy`), but
 * with its own, longer default: `minAgeDays` here doubles as "how old before
 * a key counts as stale," not just "how long since creation before this
 * scanner considers the resource at all."
 */
export class IamAccessKeyStalePolicy extends DeadResourcePolicy<IamAccessKeyStale> {
  constructor(options: DeadResourcePolicyOptions = {}) {
    super({ ...options, minAgeDays: options.minAgeDays ?? DEFAULT_ACCESS_KEY_MAX_AGE_DAYS });
  }

  protected judge(resource: IamAccessKeyStale, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within rotation window');
    }
    return flagged(resource.hygieneReason);
  }
}
