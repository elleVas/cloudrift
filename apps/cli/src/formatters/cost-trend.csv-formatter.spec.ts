// SPDX-License-Identifier: Apache-2.0
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import type { CostTrendSummary } from 'cost-analytics-domain';
import { formatCostTrendAsCsv } from './cost-trend.csv-formatter';

const meta: CostAnalyticsMeta = { accountId: '123456789012', generatedAt: new Date('2026-06-16') };

const summary: CostTrendSummary = {
  months: [
    { month: '2026-05', totalUsd: 100, final: true },
    { month: '2026-06', totalUsd: 50, final: false },
  ],
};

describe('formatCostTrendAsCsv', () => {
  it('emits a header row followed by one row per month', () => {
    const csv = formatCostTrendAsCsv(summary, meta);
    expect(csv).toBe('month,totalUsd,final\n2026-05,100,true\n2026-06,50,false');
  });
});
