// SPDX-License-Identifier: Apache-2.0
import type { CostComparisonSummary } from 'cost-analytics-domain';
import { applyCostTrendGate } from './post-analysis';

function summaryWith(changeUsd: number, changePercent: number | null): CostComparisonSummary {
  return {
    current: { start: '2026-07-01', end: '2026-07-16', totalUsd: 100 },
    previous: { start: '2026-06-01', end: '2026-06-16', totalUsd: 100 - changeUsd },
    changeUsd,
    changePercent,
    byService: [],
  };
}

let stderr: string;

beforeEach(() => {
  stderr = '';
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    stderr += args.join(' ') + '\n';
  });
  process.exitCode = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
  process.exitCode = undefined;
});

describe('applyCostTrendGate', () => {
  it('does nothing when no threshold is configured', () => {
    applyCostTrendGate(summaryWith(50, 100), undefined);
    expect(process.exitCode).toBeUndefined();
  });

  it('does nothing when the increase is within the threshold', () => {
    applyCostTrendGate(summaryWith(10, 10), 20);
    expect(process.exitCode).toBeUndefined();
  });

  it('exits with code 2 and reports the increase when the threshold is exceeded', () => {
    applyCostTrendGate(summaryWith(50, 50), 20);
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain('Spend increase threshold exceeded');
    expect(stderr).toContain('+50.0%');
  });

  it('never trips the gate on a null changePercent (previous period was $0)', () => {
    applyCostTrendGate(summaryWith(50, null), 0);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not trip exactly at the threshold (strictly greater-than)', () => {
    applyCostTrendGate(summaryWith(20, 20), 20);
    expect(process.exitCode).toBeUndefined();
  });
});
