// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { CostExplorerPort, CostPeriodBucket } from 'cost-analytics-domain';
import { CostTrendUseCase } from './cost-trend.use-case';

function monthBucket(start: string, ec2Usd: number, s3Usd: number, final: boolean): CostPeriodBucket {
  return {
    start,
    end: start, // irrelevant to this use-case
    totalUsd: ec2Usd + s3Usd,
    byService: [
      { service: 'EC2', amountUsd: ec2Usd },
      { service: 'S3', amountUsd: s3Usd },
    ].filter((s) => s.amountUsd !== 0),
    final,
  };
}

const SIX_MONTHS: CostPeriodBucket[] = [
  monthBucket('2026-02-01', 100, 10, true),
  monthBucket('2026-03-01', 110, 10, true),
  monthBucket('2026-04-01', 120, 10, true),
  monthBucket('2026-05-01', 130, 10, true),
  monthBucket('2026-06-01', 140, 10, true),
  monthBucket('2026-07-01', 90, 5, false), // current, partial month
];

describe('CostTrendUseCase', () => {
  it('maps buckets to months, unfiltered', async () => {
    const port: CostExplorerPort = { getCostAndUsage: async () => Result.ok(SIX_MONTHS) };
    const useCase = new CostTrendUseCase(port);
    const result = await useCase.execute({ today: new Date('2026-07-15T00:00:00Z') });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.months).toEqual([
      { month: '2026-02', totalUsd: 110, final: true },
      { month: '2026-03', totalUsd: 120, final: true },
      { month: '2026-04', totalUsd: 130, final: true },
      { month: '2026-05', totalUsd: 140, final: true },
      { month: '2026-06', totalUsd: 150, final: true },
      { month: '2026-07', totalUsd: 95, final: false },
    ]);
    expect(result.value.filteredServices).toBeUndefined();
  });

  it('restricts month totals to the requested services', async () => {
    const port: CostExplorerPort = { getCostAndUsage: async () => Result.ok(SIX_MONTHS) };
    const useCase = new CostTrendUseCase(port);
    const result = await useCase.execute({
      today: new Date('2026-07-15T00:00:00Z'),
      services: ['EC2'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.months.map((m) => m.totalUsd)).toEqual([100, 110, 120, 130, 140, 90]);
    expect(result.value.filteredServices).toEqual(['EC2']);
  });

  it('requests exactly `months` calendar months, including the current partial one', async () => {
    let captured: { startDate: string; endDate: string; granularity: string } | undefined;
    const port: CostExplorerPort = {
      getCostAndUsage: async (params) => {
        captured = params;
        return Result.ok([]);
      },
    };
    const useCase = new CostTrendUseCase(port);
    await useCase.execute({ today: new Date('2026-07-15T00:00:00Z'), months: 3 });

    expect(captured).toEqual({ startDate: '2026-05-01', endDate: '2026-07-16', granularity: 'MONTHLY' });
  });

  it('propagates a Cost Explorer failure unchanged', async () => {
    const port: CostExplorerPort = { getCostAndUsage: async () => Result.fail(new Error('access denied')) };
    const useCase = new CostTrendUseCase(port);
    const result = await useCase.execute({ today: new Date('2026-07-15T00:00:00Z') });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('access denied');
  });
});
