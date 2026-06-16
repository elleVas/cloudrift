import type { WastedResource } from '../wasted-resource';

export interface WasteVerdict {
  isWaste: boolean;
  reason: string;
}

export interface WastePolicyOptions {
  /** Età minima (in giorni) prima che una risorsa possa essere considerata spreco. */
  minAgeDays?: number;
  /** Tag che esclude esplicitamente una risorsa dal report. */
  ignoreTag?: string;
  /**
   * Coppie tag=valore che escludono una risorsa dal report
   * (es. { Environment: 'Production' }). Il match è esatto, case-sensitive.
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
 * Decide se una risorsa candidata è davvero spreco. Gli scanner raccolgono
 * candidati (un sovrainsieme); la policy applica le regole di business:
 * tag di esclusione, periodo di grazia e i criteri specifici per tipo.
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
