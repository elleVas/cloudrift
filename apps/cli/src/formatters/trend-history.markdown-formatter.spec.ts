// SPDX-License-Identifier: Apache-2.0
import { formatTrendHistoryAsMarkdown, sparkline } from './trend-history.markdown-formatter';
import type { TrendSnapshotRecord } from 'shared-trend-store';

function cloudCostRecord(generatedAt: string, totalWasteMonthlyUsd: number, id: number): TrendSnapshotRecord {
  return {
    id,
    domain: 'cloud-cost',
    generatedAt,
    payload: JSON.stringify({ wasteCount: 1, optimizationCount: 0, totalWasteMonthlyUsd }),
  };
}

function securityRecord(generatedAt: string, findingsCount: number, id: number): TrendSnapshotRecord {
  return {
    id,
    domain: 'resource-security',
    generatedAt,
    payload: JSON.stringify({ findings: Array.from({ length: findingsCount }, () => ({})) }),
  };
}

describe('sparkline', () => {
  it('returns an empty string for no values', () => {
    expect(sparkline([])).toBe('');
  });

  it('renders the flat middle level for a single value', () => {
    expect(sparkline([42])).toBe('▄');
  });

  it('renders the flat middle level for an all-equal series, one char per value', () => {
    expect(sparkline([10, 10, 10])).toBe('▄▄▄');
  });

  it('scales strictly increasing values from the lowest to the highest level', () => {
    const result = sparkline([0, 100]);
    expect(result[0]).toBe('▁');
    expect(result[1]).toBe('█');
  });
});

describe('formatTrendHistoryAsMarkdown', () => {
  it('shows a plain message when there is no history yet', () => {
    expect(formatTrendHistoryAsMarkdown([])).toContain('No trend history yet');
  });

  it('renders the run count, a sparkline caption, and a Markdown table row per record', () => {
    const records = [cloudCostRecord('2026-08-21T00:00:00Z', 500, 2), cloudCostRecord('2026-08-14T00:00:00Z', 100, 1)];

    const markdown = formatTrendHistoryAsMarkdown(records);

    expect(markdown).toContain('**Trend (last 2 runs)**');
    expect(markdown).toContain('($100.00 → $500.00)');
    expect(markdown).toContain('| Date | Domain | Findings | Monthly waste |');
    expect(markdown).toContain('| 2026-08-21 | cloud-cost | 1 | $500.00 |');
    expect(markdown).toContain('| 2026-08-14 | cloud-cost | 1 | $100.00 |');
  });

  it('uses singular "run" for exactly one record', () => {
    expect(formatTrendHistoryAsMarkdown([cloudCostRecord('2026-08-21T00:00:00Z', 100, 1)])).toContain('**Trend (last 1 run)**');
  });

  it('falls back to the finding count (no $) for domains with no dollar figure', () => {
    const markdown = formatTrendHistoryAsMarkdown([securityRecord('2026-08-21T00:00:00Z', 3, 1)]);

    expect(markdown).toContain('(3 → 3)');
    expect(markdown).toContain('| 2026-08-21 | resource-security | 3 | — |');
  });
});
