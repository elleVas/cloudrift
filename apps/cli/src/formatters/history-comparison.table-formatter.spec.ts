// SPDX-License-Identifier: Apache-2.0
import type { CloudCostComparison, HygieneComparison } from '../commands/history-comparison';
import { formatHistoryComparisonAsTable } from './history-comparison.table-formatter';

function cloudCostComparison(overrides: Partial<CloudCostComparison> = {}): CloudCostComparison {
  return {
    domain: 'cloud-cost',
    olderGeneratedAt: '2026-07-25T00:00:00.000Z',
    newerGeneratedAt: '2026-07-30T00:00:00.000Z',
    olderTotalWasteMonthlyUsd: 25,
    newerTotalWasteMonthlyUsd: 10,
    deltaUsd: -15,
    deltaPercent: -60,
    presumedResolvedMonthlyUsd: 15,
    resolvedFindings: [{ id: 'vol-1', kind: 'ebs-volume', monthlyCostUsd: 15 }],
    newFindings: [],
    regionsChanged: false,
    ...overrides,
  };
}

function hygieneComparison(overrides: Partial<HygieneComparison> = {}): HygieneComparison {
  return {
    domain: 'dead-resources',
    olderGeneratedAt: '2026-07-25T00:00:00.000Z',
    newerGeneratedAt: '2026-07-30T00:00:00.000Z',
    olderCountBySeverity: { info: 2, warning: 0, critical: 0 },
    newerCountBySeverity: { info: 1, warning: 0, critical: 0 },
    resolvedFindings: [{ id: 'kp-1', kind: 'ec2-keypair-unused', severity: 'info' }],
    newFindings: [],
    regionsChanged: false,
    ...overrides,
  };
}

describe('formatHistoryComparisonAsTable', () => {
  it('renders the cloud-cost comparison with the resolved finding and presumed-resolved total', () => {
    const output = formatHistoryComparisonAsTable(cloudCostComparison());
    expect(output).toContain('Comparing 2026-07-25 → 2026-07-30');
    expect(output).toContain('$25.00 → $10.00');
    expect(output).toContain('Presumed resolved: $15.00/mo');
    expect(output).toContain('ebs-volume vol-1');
  });

  it('renders new findings and omits the presumed-resolved line when nothing resolved', () => {
    const output = formatHistoryComparisonAsTable(
      cloudCostComparison({ resolvedFindings: [], presumedResolvedMonthlyUsd: 0, newFindings: [{ id: 'vol-new', kind: 'ebs-volume', monthlyCostUsd: 8 }] }),
    );
    expect(output).toContain('No findings resolved');
    expect(output).toContain('New waste since then: 1 finding(s)');
  });

  it('flags a region mismatch caveat', () => {
    const output = formatHistoryComparisonAsTable(cloudCostComparison({ regionsChanged: true }));
    expect(output).toContain('scanned different regions');
  });

  it('renders a hygiene-domain comparison with severity breakdown', () => {
    const output = formatHistoryComparisonAsTable(hygieneComparison());
    expect(output).toContain('Findings: 2 → 1');
    expect(output).toContain('critical 0→0');
    expect(output).toContain('Resolved: 1 finding(s)');
    expect(output).toContain('ec2-keypair-unused kp-1');
  });

  it('renders new hygiene findings', () => {
    const output = formatHistoryComparisonAsTable(hygieneComparison({ resolvedFindings: [], newFindings: [{ id: 'kp-3', kind: 'ec2-keypair-unused', severity: 'warning' }] }));
    expect(output).toContain('New: 1 finding(s)');
  });
});
