// SPDX-License-Identifier: Apache-2.0
import type { DeadResource } from '../dead-resource';

export interface HygieneVerdict {
  flagged: boolean;
  reason: string;
}

export interface DeadResourcePolicyOptions {
  /** Minimum age (in days) before a resource can be flagged. */
  minAgeDays?: number;
  /** Tag that explicitly excludes a resource from the report. */
  ignoreTag?: string;
  /**
   * tag=value pairs that exclude a resource from the report
   * (e.g. { Environment: 'Production' }). The match is exact, case-sensitive.
   */
  excludeTagValues?: Record<string, string>;
}

export const DEFAULT_MIN_AGE_DAYS = 7;
export const DEFAULT_IGNORE_TAG = 'cloudrift:ignore';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function flagged(reason: string): HygieneVerdict {
  return { flagged: true, reason };
}

export function notFlagged(reason: string): HygieneVerdict {
  return { flagged: false, reason };
}

/**
 * Decides whether a candidate is really worth flagging. Scanners collect
 * candidates (a superset); the policy applies the business rules: exclusion
 * tag, grace period, and the type-specific criteria. Mirrors
 * `cloud-cost-domain`'s `WastePolicy` shape deliberately (same
 * ignoreTag/excludeTagValues/grace-period machinery is domain-agnostic) but
 * is a separate class so this domain has zero import-time dependency on
 * `cloud-cost-domain`'s policy layer (ADR-0078).
 */
export abstract class DeadResourcePolicy<T extends DeadResource> {
  protected readonly minAgeDays: number;
  protected readonly ignoreTag: string;
  protected readonly excludeTagValues: Record<string, string>;

  constructor(options: DeadResourcePolicyOptions = {}) {
    this.minAgeDays = options.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
    this.ignoreTag = options.ignoreTag ?? DEFAULT_IGNORE_TAG;
    this.excludeTagValues = options.excludeTagValues ?? {};
  }

  evaluate(resource: T, now: Date = new Date()): HygieneVerdict {
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

  protected abstract judge(resource: T, now: Date): HygieneVerdict;

  protected ageInDays(since: Date, now: Date): number {
    return (now.getTime() - since.getTime()) / MS_PER_DAY;
  }

  protected isWithinGracePeriod(since: Date, now: Date): boolean {
    return this.ageInDays(since, now) < this.minAgeDays;
  }
}
