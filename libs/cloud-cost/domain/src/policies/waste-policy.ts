// SPDX-License-Identifier: Apache-2.0
import type { WastedResource } from '../wasted-resource';

export interface WasteVerdict {
  isWaste: boolean;
  reason: string;
}

export interface WastePolicyOptions {
  /** Minimum age (in days) before a resource can be considered waste. */
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

export function waste(reason: string): WasteVerdict {
  return { isWaste: true, reason };
}

export function notWaste(reason: string): WasteVerdict {
  return { isWaste: false, reason };
}

/**
 * Decides whether a candidate resource is really waste. Scanners collect
 * candidates (a superset); the policy applies the business rules:
 * exclusion tag, grace period, and the type-specific criteria.
 */
export abstract class WastePolicy<T extends WastedResource> {
  protected readonly minAgeDays: number;
  protected readonly ignoreTag: string;
  protected readonly excludeTagValues: Record<string, string>;

  constructor(options: WastePolicyOptions = {}) {
    this.minAgeDays = options.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
    this.ignoreTag = options.ignoreTag ?? DEFAULT_IGNORE_TAG;
    this.excludeTagValues = options.excludeTagValues ?? {};
  }

  evaluate(resource: T, now: Date = new Date()): WasteVerdict {
    if (this.ignoreTag in resource.tags) {
      return notWaste(`excluded by tag ${this.ignoreTag}`);
    }
    for (const [key, value] of Object.entries(this.excludeTagValues)) {
      if (resource.tags[key] === value) {
        return notWaste(`excluded by tag ${key}=${value}`);
      }
    }
    return this.judge(resource, now);
  }

  protected abstract judge(resource: T, now: Date): WasteVerdict;

  protected ageInDays(since: Date, now: Date): number {
    return (now.getTime() - since.getTime()) / MS_PER_DAY;
  }

  protected isWithinGracePeriod(since: Date, now: Date): boolean {
    return this.ageInDays(since, now) < this.minAgeDays;
  }
}
