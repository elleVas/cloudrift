// SPDX-License-Identifier: Apache-2.0
import type { CostComparisonSummary } from 'cost-analytics-domain';
import { toCostComparisonDto } from './cost-comparison.dto';
import type { CostAnalyticsMeta } from './cost-comparison.dto';
import { COST_REPORT_DISCLAIMER, REPORT_CONTACT } from '../constants/report-disclaimer';

function makeSummary(overrides: Partial<CostComparisonSummary> = {}): CostComparisonSummary {
  return {
    current: { start: '2026-07-01', end: '2026-07-27', totalUsd: 120 },
    previous: { start: '2026-06-01', end: '2026-06-27', totalUsd: 100 },
    changeUsd: 20,
    changePercent: 20,
    byService: [
      { service: 'EC2', currentUsd: 80, previousUsd: 60, changeUsd: 20, changePercent: 33.33 },
    ],
    ...overrides,
  };
}

const meta: CostAnalyticsMeta = { accountId: '123456789012', generatedAt: new Date('2026-07-27T00:00:00Z') };

describe('toCostComparisonDto', () => {
  it('formats meta.generatedAt as an ISO string and passes through the account id', () => {
    const dto = toCostComparisonDto(makeSummary(), meta);
    expect(dto.meta).toEqual({ accountId: '123456789012', generatedAt: '2026-07-27T00:00:00.000Z' });
  });

  it('carries the shared disclaimer and contact', () => {
    const dto = toCostComparisonDto(makeSummary(), meta);
    expect(dto.disclaimer).toBe(COST_REPORT_DISCLAIMER);
    expect(dto.contact).toEqual(REPORT_CONTACT);
  });

  it('passes through the summary fields unchanged', () => {
    const summary = makeSummary();
    const dto = toCostComparisonDto(summary, meta);
    expect(dto.current).toBe(summary.current);
    expect(dto.previous).toBe(summary.previous);
    expect(dto.changeUsd).toBe(summary.changeUsd);
    expect(dto.changePercent).toBe(summary.changePercent);
    expect(dto.byService).toBe(summary.byService);
  });

  it('preserves a null changePercent (previous period was $0)', () => {
    const dto = toCostComparisonDto(makeSummary({ changePercent: null }), meta);
    expect(dto.changePercent).toBeNull();
  });
});
