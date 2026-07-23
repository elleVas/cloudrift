// SPDX-License-Identifier: Apache-2.0
import type { SecurityFinding } from '../resource-security';

export interface RiskVerdict {
  flagged: boolean;
  reason: string;
}

export interface ResourceSecurityPolicyOptions {
  /** Tag that explicitly excludes a resource from the report. */
  ignoreTag?: string;
  /**
   * tag=value pairs that exclude a resource from the report
   * (e.g. { Environment: 'Sandbox' }). The match is exact, case-sensitive.
   */
  excludeTagValues?: Record<string, string>;
}

export const DEFAULT_IGNORE_TAG = 'cloudrift:ignore';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function flagged(reason: string): RiskVerdict {
  return { flagged: true, reason };
}

export function notFlagged(reason: string): RiskVerdict {
  return { flagged: false, reason };
}

/**
 * Decides whether a candidate is really worth flagging. Scanners collect
 * candidates; the policy applies the exclusion tag and the type-specific
 * criteria. Structurally similar to `dead-resources-domain`'s
 * `DeadResourcePolicy` but deliberately has no `minAgeDays`/grace-period
 * concept: a security misconfiguration (open ingress, no MFA, unencrypted
 * volume) is a risk from the moment it exists, not after N days — unlike
 * cost-hygiene findings there is no "still settling in" period to wait out.
 * The one kind that does need an age threshold (`iam-access-key-rotation-
 * overdue`) computes it itself in its own `judge()`, using the `now`
 * parameter below, rather than adding grace-period machinery every other
 * kind would have to ignore.
 */
export abstract class ResourceSecurityPolicy<T extends SecurityFinding> {
  protected readonly ignoreTag: string;
  protected readonly excludeTagValues: Record<string, string>;

  constructor(options: ResourceSecurityPolicyOptions = {}) {
    this.ignoreTag = options.ignoreTag ?? DEFAULT_IGNORE_TAG;
    this.excludeTagValues = options.excludeTagValues ?? {};
  }

  evaluate(resource: T, now: Date = new Date()): RiskVerdict {
    if (this.ignoreTag in resource.tags) {
      return notFlagged(`excluded by tag ${this.ignoreTag}`);
    }
    for (const [key, value] of Object.entries(this.excludeTagValues)) {
      if (resource.tags[key] === value) {
        return notFlagged(`excluded by tag ${key}=${value}`);
      }
    }
    return this.judge(resource, now);
  }

  protected abstract judge(resource: T, now: Date): RiskVerdict;

  protected ageInDays(since: Date, now: Date): number {
    return (now.getTime() - since.getTime()) / MS_PER_DAY;
  }
}
