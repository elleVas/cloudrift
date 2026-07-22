// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Result } from 'shared-kernel';
import type { CostExplorerPort, CostPeriodBucket } from 'cloud-cost-domain';
import { CachedCostExplorerAdapter } from './cost-explorer-cache.adapter';

const BUCKET: CostPeriodBucket[] = [
  { start: '2026-06-01', end: '2026-06-02', totalUsd: 10, byService: [], final: true },
];

function countingPort(): { port: CostExplorerPort; calls: () => number } {
  let calls = 0;
  return {
    port: {
      getCostAndUsage: async () => {
        calls++;
        return Result.ok(BUCKET);
      },
    },
    calls: () => calls,
  };
}

describe('CachedCostExplorerAdapter', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'cloudrift-cost-cache-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const NOW = () => new Date('2026-07-15T00:00:00Z');
  const CLOSED_RANGE = { startDate: '2026-06-01', endDate: '2026-06-02', granularity: 'MONTHLY' as const };
  // Ends "today" — still open, must never be cached.
  const OPEN_RANGE = { startDate: '2026-07-01', endDate: '2026-07-15', granularity: 'MONTHLY' as const };

  it('calls through once and serves subsequent identical closed-range requests from disk', async () => {
    const { port, calls } = countingPort();
    const adapter = new CachedCostExplorerAdapter(port, '111111111111', { cacheDir, now: NOW });

    const first = await adapter.getCostAndUsage(CLOSED_RANGE);
    const second = await adapter.getCostAndUsage(CLOSED_RANGE);

    expect(calls()).toBe(1);
    expect(first).toEqual(second);
    expect(first.ok && first.value).toEqual(BUCKET);
  });

  it('never caches a range touching the current, still-open period', async () => {
    const { port, calls } = countingPort();
    const adapter = new CachedCostExplorerAdapter(port, '111111111111', { cacheDir, now: NOW });

    await adapter.getCostAndUsage(OPEN_RANGE);
    await adapter.getCostAndUsage(OPEN_RANGE);

    expect(calls()).toBe(2);
  });

  it('bypasses the cache when refresh is set, but still writes the fresh result back', async () => {
    const counting1 = countingPort();
    const adapter1 = new CachedCostExplorerAdapter(counting1.port, '111111111111', { cacheDir, now: NOW });
    await adapter1.getCostAndUsage(CLOSED_RANGE);
    expect(counting1.calls()).toBe(1);

    const counting2 = countingPort();
    const adapter2 = new CachedCostExplorerAdapter(counting2.port, '111111111111', {
      cacheDir,
      now: NOW,
      refresh: true,
    });
    await adapter2.getCostAndUsage(CLOSED_RANGE);
    expect(counting2.calls()).toBe(1); // refresh bypassed the cache written by adapter1
  });

  it('keys the cache per account, so different accounts never share a cached response', async () => {
    const { port, calls } = countingPort();
    const adapterA = new CachedCostExplorerAdapter(port, 'account-a', { cacheDir, now: NOW });
    const adapterB = new CachedCostExplorerAdapter(port, 'account-b', { cacheDir, now: NOW });

    await adapterA.getCostAndUsage(CLOSED_RANGE);
    await adapterB.getCostAndUsage(CLOSED_RANGE);

    expect(calls()).toBe(2);
  });

  it('propagates a failure from the inner adapter without caching it', async () => {
    let calls = 0;
    const failingThenOk: CostExplorerPort = {
      getCostAndUsage: async () => {
        calls++;
        return calls === 1 ? Result.fail(new Error('throttled')) : Result.ok(BUCKET);
      },
    };
    const adapter = new CachedCostExplorerAdapter(failingThenOk, '111111111111', { cacheDir, now: NOW });

    const first = await adapter.getCostAndUsage(CLOSED_RANGE);
    expect(first.ok).toBe(false);

    const second = await adapter.getCostAndUsage(CLOSED_RANGE);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2); // the failed call was never cached, so the retry hits the port again
  });
});
