// SPDX-License-Identifier: Apache-2.0
import type { CostTrendSummary } from 'cost-analytics-domain';
import { toCostTrendDto } from './cost-trend.dto';
import type { CostAnalyticsMeta } from './cost-comparison.dto';
import { COST_REPORT_DISCLAIMER, REPORT_CONTACT } from '../constants/report-disclaimer';

function makeSummary(overrides: Partial<CostTrendSummary> = {}): CostTrendSummary {
  return {
    months: [
      { month: '2026-06', totalUsd: 100, final: true },
      { month: '2026-07', totalUsd: 60, final: false },
    ],
    ...overrides,
  };
}

const meta: CostAnalyticsMeta = { accountId: '123456789012', generatedAt: new Date('2026-07-27T00:00:00Z') };

describe('toCostTrendDto', () => {
  it('formats meta.generatedAt as an ISO string and passes through the account id', () => {
    const dto = toCostTrendDto(makeSummary(), meta);
    expect(dto.meta).toEqual({ accountId: '123456789012', generatedAt: '2026-07-27T00:00:00.000Z' });
  });

  it('carries the shared disclaimer and contact', () => {
    const dto = toCostTrendDto(makeSummary(), meta);
    expect(dto.disclaimer).toBe(COST_REPORT_DISCLAIMER);
    expect(dto.contact).toEqual(REPORT_CONTACT);
  });

  it('passes through months unchanged', () => {
    const summary = makeSummary();
    const dto = toCostTrendDto(summary, meta);
    expect(dto.months).toBe(summary.months);
  });

  it('omits filteredServices when the summary has none', () => {
    const dto = toCostTrendDto(makeSummary({ filteredServices: undefined }), meta);
    expect(dto.filteredServices).toBeUndefined();
  });

  it('passes through filteredServices when present', () => {
    const dto = toCostTrendDto(makeSummary({ filteredServices: ['EC2', 'S3'] }), meta);
    expect(dto.filteredServices).toEqual(['EC2', 'S3']);
  });
});
