// SPDX-License-Identifier: Apache-2.0
import type { TrendSnapshotRecord } from 'shared-trend-store';
import { generateHistoryReportHtml } from './history-report.html-formatter';

function wasteRecord(id: number, generatedAt: string, totalWasteMonthlyUsd: number, findingIds: string[]): TrendSnapshotRecord {
  return {
    id,
    domain: 'cloud-cost',
    generatedAt,
    payload: JSON.stringify({
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt },
      totalWasteMonthlyUsd,
      findings: findingIds.map((fid) => ({ id: fid, kind: 'ebs-volume', monthlyCostUsd: totalWasteMonthlyUsd / (findingIds.length || 1) })),
    }),
  };
}

function hygieneRecord(id: number, generatedAt: string, countBySeverity: Record<string, number>): TrendSnapshotRecord {
  return {
    id,
    domain: 'dead-resources',
    generatedAt,
    payload: JSON.stringify({
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt },
      countBySeverity,
      findings: [],
    }),
  };
}

describe('generateHistoryReportHtml', () => {
  it('produces a self-contained HTML document with a chart, summary, and table for cloud-cost', () => {
    const records = [
      wasteRecord(2, '2026-07-30T00:00:00.000Z', 10, ['vol-2']),
      wasteRecord(1, '2026-07-25T00:00:00.000Z', 25, ['vol-1', 'vol-2']),
    ];

    const html = generateHistoryReportHtml(records, 'cloud-cost', '123456789012');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<svg');
    expect(html).toContain('viz-line');
    expect(html).toContain('viz-area');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('$25.00');
    expect(html).toContain('$10.00');
    expect(html).toContain('presumed resolved');
    expect(html).toContain('<table class="viz-table">');
    expect(html).toContain('2026-07-25');
    expect(html).toContain('2026-07-30');
  });

  it('produces a hygiene report using finding counts instead of dollars', () => {
    const records = [
      hygieneRecord(2, '2026-07-30T00:00:00.000Z', { info: 1, warning: 0, critical: 0 }),
      hygieneRecord(1, '2026-07-25T00:00:00.000Z', { info: 2, warning: 0, critical: 0 }),
    ];

    const html = generateHistoryReportHtml(records, 'dead-resources', '123456789012');

    expect(html).toContain('Resolved');
    expect(html).toContain('Findings');
    expect(html).not.toContain('presumed resolved');
  });

  it('renders without a chart when there is only one snapshot, but still shows the table', () => {
    const records = [wasteRecord(1, '2026-07-30T00:00:00.000Z', 10, ['vol-1'])];
    const html = generateHistoryReportHtml(records, 'cloud-cost', '123456789012');

    expect(html).toContain('<table class="viz-table">');
    expect(html).not.toContain('presumed resolved');
  });

  it('renders gracefully with zero snapshots', () => {
    const html = generateHistoryReportHtml([], 'cloud-cost', '123456789012');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<tbody></tbody>');
  });

  it('HTML-escapes the account ID to prevent injection via a spoofed --account-id', () => {
    const html = generateHistoryReportHtml([], 'cloud-cost', '<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
