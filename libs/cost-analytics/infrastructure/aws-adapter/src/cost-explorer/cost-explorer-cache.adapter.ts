// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { Result } from 'shared-kernel';
import type { CostExplorerPort, CostPeriodBucket } from 'cost-analytics-domain';

export function defaultCostExplorerCacheDir(): string {
  return join(homedir(), '.cloudrift', 'cache', 'cost-explorer');
}

/**
 * Decorator around a real `CostExplorerPort`: Cost Explorer bills $0.01 per
 * API request regardless of how much data comes back, so re-fetching data
 * that can no longer change wastes money, not just time (unlike every other
 * adapter in this codebase, which calls free describe/list APIs). Caches a
 * whole query's response on disk, keyed by its exact parameters — but only
 * once every bucket in the requested range is safely closed. A range
 * touching the current, still-open billing period is never cached, since
 * that data changes until AWS finalizes it.
 */
export class CachedCostExplorerAdapter implements CostExplorerPort {
  constructor(
    private readonly inner: CostExplorerPort,
    private readonly accountId: string,
    private readonly options: { cacheDir?: string; refresh?: boolean; now?: () => Date } = {},
  ) {}

  async getCostAndUsage(params: {
    startDate: string;
    endDate: string;
    granularity: 'DAILY' | 'MONTHLY';
  }): Promise<Result<CostPeriodBucket[]>> {
    const cacheable = this.isRangeSafelyClosed(params.endDate);
    const cachePath = this.cachePathFor(params);

    if (cacheable && !this.options.refresh) {
      const cached = await this.readCache(cachePath);
      if (cached) return Result.ok(cached);
    }

    const result = await this.inner.getCostAndUsage(params);
    if (result.ok && cacheable) {
      await this.writeCache(cachePath, result.value);
    }
    return result;
  }

  /**
   * Safe only once the whole requested range ends more than 2 days in the
   * past: Cost Explorer can still finalize/adjust the most recent 24-48h of
   * data even for a calendar day that has technically closed, per AWS's own
   * documented reconciliation lag.
   */
  private isRangeSafelyClosed(endDate: string): boolean {
    const now = this.options.now?.() ?? new Date();
    const safeCutoff = new Date(now);
    safeCutoff.setUTCDate(safeCutoff.getUTCDate() - 2);
    return new Date(`${endDate}T00:00:00Z`) <= safeCutoff;
  }

  private cachePathFor(params: { startDate: string; endDate: string; granularity: string }): string {
    const dir = this.options.cacheDir ?? defaultCostExplorerCacheDir();
    const key = `${params.granularity}_${params.startDate}_${params.endDate}.json`;
    return join(dir, this.accountId, key);
  }

  private async readCache(path: string): Promise<CostPeriodBucket[] | undefined> {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as CostPeriodBucket[];
    } catch {
      return undefined;
    }
  }

  private async writeCache(path: string, buckets: CostPeriodBucket[]): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(buckets));
    } catch {
      // The cache is a pure optimization: a write failure (e.g. a read-only
      // filesystem) must never fail the command itself.
    }
  }
}
