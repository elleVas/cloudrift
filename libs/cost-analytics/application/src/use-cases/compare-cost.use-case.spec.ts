// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { CostExplorerPort, CostPeriodBucket } from 'cost-analytics-domain';
import { CompareCostUseCase } from './compare-cost.use-case';

function addOneDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function bucket(start: string, ec2Usd: number, s3Usd: number): CostPeriodBucket {
  return {
    start,
    end: addOneDay(start),
    totalUsd: ec2Usd + s3Usd,
    byService: [
      { service: 'EC2', amountUsd: ec2Usd },
      { service: 'S3', amountUsd: s3Usd },
    ].filter((s) => s.amountUsd !== 0),
    final: true,
  };
}

function fakePort(buckets: CostPeriodBucket[]): CostExplorerPort {
  return { getCostAndUsage: async () => Result.ok(buckets) };
}

function failingPort(message: string): CostExplorerPort {
  return { getCostAndUsage: async () => Result.fail(new Error(message)) };
}

describe('CompareCostUseCase', () => {
  it('compares the same day-of-month window in the current vs. previous month', async () => {
    const buckets: CostPeriodBucket[] = [];
    // Previous month (June 2026): 1st-15th costs $10/day EC2.
    for (let day = 1; day <= 15; day++) {
      buckets.push(bucket(`2026-06-${String(day).padStart(2, '0')}`, 10, 0));
    }
    // Current month (July 2026): 1st-15th costs $20/day EC2 + $5/day S3.
    for (let day = 1; day <= 15; day++) {
      buckets.push(bucket(`2026-07-${String(day).padStart(2, '0')}`, 20, 5));
    }

    const useCase = new CompareCostUseCase(fakePort(buckets));
    const result = await useCase.execute({ today: new Date('2026-07-15T12:00:00Z') });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.current).toEqual({ start: '2026-07-01', end: '2026-07-16', totalUsd: 375 });
    expect(result.value.previous).toEqual({ start: '2026-06-01', end: '2026-06-16', totalUsd: 150 });
    expect(result.value.changeUsd).toBe(225);
    expect(result.value.changePercent).toBeCloseTo(150, 5);

    const ec2 = result.value.byService.find((s) => s.service === 'EC2');
    expect(ec2).toEqual({ service: 'EC2', currentUsd: 300, previousUsd: 150, changeUsd: 150, changePercent: 100 });
    const s3 = result.value.byService.find((s) => s.service === 'S3');
    expect(s3).toEqual({ service: 'S3', currentUsd: 75, previousUsd: 0, changeUsd: 75, changePercent: null });
    // Sorted by |changeUsd| descending.
    expect(result.value.byService[0].service).toBe('EC2');
  });

  it('clips the previous period instead of spilling into the current month when it is shorter', async () => {
    // 2026 is not a leap year: February has 28 days, March has 31.
    const useCase = new CompareCostUseCase(fakePort([]));
    const result = await useCase.execute({ today: new Date('2026-03-31T00:00:00Z') });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.current.start).toBe('2026-03-01');
    expect(result.value.current.end).toBe('2026-04-01');
    // Clipped to all of February (28 days), not 31 days spilling into March.
    expect(result.value.previous.start).toBe('2026-02-01');
    expect(result.value.previous.end).toBe('2026-03-01');
  });

  it('propagates a Cost Explorer failure unchanged', async () => {
    const useCase = new CompareCostUseCase(failingPort('throttled'));
    const result = await useCase.execute({ today: new Date('2026-07-15T00:00:00Z') });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('throttled');
  });

  it('reports changePercent as null (not an astronomical number) when the previous period rounds to $0.00', async () => {
    // A sub-cent real charge (e.g. a fractional Route 53 line item) displays
    // as previous.totalUsd === 0.00 — changePercent must agree with that,
    // not divide by the un-rounded fraction.
    const buckets: CostPeriodBucket[] = [
      { start: '2026-06-01', end: '2026-06-02', totalUsd: 0.001, byService: [{ service: 'Route 53', amountUsd: 0.001 }], final: true },
      { start: '2026-07-15', end: '2026-07-16', totalUsd: 51.32, byService: [{ service: 'Amazon Redshift', amountUsd: 51.32 }], final: true },
    ];
    const useCase = new CompareCostUseCase(fakePort(buckets));
    const result = await useCase.execute({ today: new Date('2026-07-15T12:00:00Z') });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.previous.totalUsd).toBe(0);
    expect(result.value.current.totalUsd).toBe(51.32);
    expect(result.value.changePercent).toBeNull();
  });
});
