// SPDX-License-Identifier: Apache-2.0
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import type { CostComparisonSummary } from 'cost-analytics-domain';
import { formatCostComparisonAsCsv } from './cost-comparison.csv-formatter';

const meta: CostAnalyticsMeta = { accountId: '123456789012', generatedAt: new Date('2026-06-16') };

const summary: CostComparisonSummary = {
  current: { start: '2026-06-01', end: '2026-06-16', totalUsd: 120 },
  previous: { start: '2026-05-01', end: '2026-05-16', totalUsd: 100 },
  changeUsd: 20,
  changePercent: 20,
  byService: [
    { service: 'EC2', currentUsd: 100, previousUsd: 80, changeUsd: 20, changePercent: 25 },
    { service: 'S3', currentUsd: 20, previousUsd: 20, changeUsd: 0, changePercent: null },
  ],
};

describe('formatCostComparisonAsCsv', () => {
  it('emits a header row followed by one row per service delta', () => {
    const csv = formatCostComparisonAsCsv(summary, meta);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('service,currentUsd,previousUsd,changeUsd,changePercent');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('EC2,100,80,20,25');
    expect(lines[2]).toBe('S3,20,20,0,');
  });
});
