// SPDX-License-Identifier: Apache-2.0
import type { TrendSnapshotRecord } from 'shared-trend-store';
import { generateHistoryReportHtml, generateCombinedHistoryReportHtml } from './history-report.html-formatter';

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

function wasteRecordWithBreakdown(
  id: number,
  generatedAt: string,
  totalWasteMonthlyUsd: number,
  breakdown: Array<{ label: string; monthlyCostUsd: number; category?: string }>,
): TrendSnapshotRecord {
  return {
    id,
    domain: 'cloud-cost',
    generatedAt,
    payload: JSON.stringify({
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt },
      totalWasteMonthlyUsd,
      findings: [],
      breakdown: breakdown.map((b) => ({ kind: 'x', label: b.label, category: b.category ?? 'waste', estimated: false, count: 1, monthlyCostUsd: b.monthlyCostUsd })),
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

  it('charts critical/warning/info as three separate lines with a legend and per-severity table columns', () => {
    const records = [
      hygieneRecord(2, '2026-07-30T00:00:00.000Z', { critical: 2, warning: 5, info: 1 }),
      hygieneRecord(1, '2026-07-25T00:00:00.000Z', { critical: 1, warning: 3, info: 4 }),
    ];

    const html = generateHistoryReportHtml(records, 'resource-security', '123456789012');

    expect(html).toContain('viz-line-critical');
    expect(html).toContain('viz-line-warning');
    expect(html).toContain('viz-line-info');
    expect(html).toContain('viz-legend');
    expect(html).toContain('>Critical<');
    expect(html).toContain('>Warning<');
    expect(html).toContain('>Info<');
    expect(html).toContain('<th>Critical</th><th>Warning</th><th>Info</th>');
    expect(html).not.toContain('<th>Findings</th>');
    // Latest run's counts (table renders most-recent-first, matching readTrendSnapshots' ordering).
    expect(html).toContain('<td>2</td><td>5</td><td>1</td>');
    expect(html).toContain('<td>1</td><td>3</td><td>4</td>');
  });

  it('lists the top 3 waste-category resource kinds by $ from the latest run, excluding optimization entries', () => {
    const records = [
      wasteRecordWithBreakdown(1, '2026-07-30T00:00:00.000Z', 100, [
        { label: 'NAT Gateways', monthlyCostUsd: 32.4 },
        { label: 'EBS Volumes', monthlyCostUsd: 40 },
        { label: 'Elastic IPs', monthlyCostUsd: 3.6 },
        { label: 'Load Balancers', monthlyCostUsd: 16.2 },
        { label: 'gp2 upgrades', monthlyCostUsd: 999, category: 'optimization' },
      ]),
    ];

    const html = generateHistoryReportHtml(records, 'cloud-cost', '123456789012');

    expect(html).toContain('Top resource types by waste');
    expect(html).toContain('EBS Volumes');
    expect(html).toContain('$40.00/mo');
    expect(html).toContain('NAT Gateways');
    expect(html).toContain('Load Balancers');
    expect(html).not.toContain('Elastic IPs');
    expect(html).not.toContain('gp2 upgrades');
  });

  it('omits the top-wasters list when the payload has no breakdown data', () => {
    const records = [wasteRecord(1, '2026-07-30T00:00:00.000Z', 10, ['vol-1'])];
    const html = generateHistoryReportHtml(records, 'cloud-cost', '123456789012');
    expect(html).not.toContain('Top resource types by waste');
  });

  // The page's <style> block unconditionally defines all three
  // `.viz-health-*` rules, so a bare `toContain('viz-health-warning')` would
  // always pass regardless of which dot is actually rendered — assert on the
  // dot's own class attribute instead, which only appears once per section.
  function healthDotClass(html: string): string {
    const match = /<span class="viz-health-dot viz-health-(\w+)"/.exec(html);
    if (!match) throw new Error('no health dot found in rendered HTML');
    return match[1];
  }

  it('shows a warning health dot on cloud-cost when waste is trending up, good when it is flat or down', () => {
    const up = generateHistoryReportHtml(
      [wasteRecord(2, '2026-07-30T00:00:00.000Z', 25, ['vol-1']), wasteRecord(1, '2026-07-25T00:00:00.000Z', 10, ['vol-1'])],
      'cloud-cost',
      '123456789012',
    );
    expect(healthDotClass(up)).toBe('warning');

    const down = generateHistoryReportHtml(
      [wasteRecord(2, '2026-07-30T00:00:00.000Z', 10, ['vol-1']), wasteRecord(1, '2026-07-25T00:00:00.000Z', 25, ['vol-1'])],
      'cloud-cost',
      '123456789012',
    );
    expect(healthDotClass(down)).toBe('good');
  });

  it("shows a critical/warning/good health dot on resource-security matching the latest run's severity", () => {
    const critical = generateHistoryReportHtml([hygieneRecord(1, '2026-07-30T00:00:00.000Z', { critical: 1, warning: 0, info: 0 })], 'resource-security', '123456789012');
    expect(healthDotClass(critical)).toBe('critical');

    const warning = generateHistoryReportHtml([hygieneRecord(1, '2026-07-30T00:00:00.000Z', { critical: 0, warning: 2, info: 0 })], 'resource-security', '123456789012');
    expect(healthDotClass(warning)).toBe('warning');

    const clear = generateHistoryReportHtml([hygieneRecord(1, '2026-07-30T00:00:00.000Z', { critical: 0, warning: 0, info: 3 })], 'resource-security', '123456789012');
    expect(healthDotClass(clear)).toBe('good');
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

describe('generateCombinedHistoryReportHtml', () => {
  it('stacks one card per domain on a single page', () => {
    const recordsByDomain = {
      'cloud-cost': [wasteRecord(1, '2026-07-30T00:00:00.000Z', 10, ['vol-1'])],
      'dead-resources': [hygieneRecord(2, '2026-07-30T00:00:00.000Z', { info: 1 })],
      'resource-security': [{ ...hygieneRecord(3, '2026-07-30T00:00:00.000Z', { critical: 2 }), domain: 'resource-security' as const }],
    };

    const html = generateCombinedHistoryReportHtml(recordsByDomain, '123456789012');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('cloud-cost — local scan history');
    expect(html).toContain('dead-resources — local scan history');
    expect(html).toContain('resource-security — local scan history');
    expect(html.match(/class="viz-chart-wrap"/g) ?? []).toHaveLength(3);
  });

  it('renders gracefully when a domain has no snapshots on record', () => {
    const html = generateCombinedHistoryReportHtml({ 'cloud-cost': [], 'dead-resources': [], 'resource-security': [] }, '123456789012');

    expect(html).toContain('<!doctype html>');
    expect(html.match(/<tbody><\/tbody>/g) ?? []).toHaveLength(3);
  });

  it('gives every stat tile and every section its own health dot, independent of the other domains', () => {
    const html = generateCombinedHistoryReportHtml(
      {
        'cloud-cost': [wasteRecord(1, '2026-07-30T00:00:00.000Z', 10, ['vol-1'])],
        'dead-resources': [hygieneRecord(1, '2026-07-30T00:00:00.000Z', { info: 1, warning: 0, critical: 0 })],
        'resource-security': [{ ...hygieneRecord(2, '2026-07-30T00:00:00.000Z', { critical: 2, warning: 1, info: 0 }), domain: 'resource-security' as const }],
      },
      '123456789012',
    );

    const dots = [...html.matchAll(/class="viz-health-dot viz-health-(\w+)"/g)].map((m) => m[1]);
    // 3 exec-summary stat tiles + 3 section headings = 6 dots total.
    expect(dots).toHaveLength(6);
    // Security is critical while dead-resources/cost are not — no single
    // combined status could represent both without hiding one of them.
    expect(dots.filter((d) => d === 'critical')).toHaveLength(2); // security stat tile + security section heading
    expect(dots.filter((d) => d === 'good')).toHaveLength(4); // cost + dead-resources, tile + heading each
  });
});
