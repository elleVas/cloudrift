// SPDX-License-Identifier: Apache-2.0
import type { WasteReportDto } from 'cloud-cost-application';
import type { DeadResourcesReportDto } from 'dead-resources-application';
import { compareCloudCostSnapshots, compareHygieneSnapshots } from './history-comparison';

function wasteReport(overrides: Partial<WasteReportDto> = {}): WasteReportDto {
  return {
    meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-07-01T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false },
    disclaimer: '',
    contact: { email: '', linkedin: '' },
    totalWasteMonthlyUsd: 0,
    totalWasteAnnualUsd: 0,
    totalOptimizationMonthlyUsd: 0,
    wasteCount: 0,
    optimizationCount: 0,
    breakdown: [],
    findings: [],
    scanErrors: [],
    ...overrides,
  };
}

function finding(id: string, monthlyCostUsd: number) {
  return {
    id,
    kind: 'ebs-volume' as const,
    category: 'waste' as const,
    estimated: false,
    region: 'us-east-1',
    accountId: '123456789012',
    detectedAt: '2026-06-01T00:00:00.000Z',
    wasteReason: 'unattached',
    description: '',
    monthlyCostUsd,
    tags: {},
  };
}

describe('compareCloudCostSnapshots', () => {
  it('computes the total delta and presumed-resolved sum for findings that disappeared', () => {
    const older = wasteReport({
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-07-25T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false },
      totalWasteMonthlyUsd: 25,
      findings: [finding('vol-1', 15), finding('vol-2', 10)],
    });
    const newer = wasteReport({
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-07-30T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false },
      totalWasteMonthlyUsd: 10,
      findings: [finding('vol-2', 10)],
    });

    const result = compareCloudCostSnapshots(older, newer);

    expect(result.olderTotalWasteMonthlyUsd).toBe(25);
    expect(result.newerTotalWasteMonthlyUsd).toBe(10);
    expect(result.deltaUsd).toBe(-15);
    expect(result.deltaPercent).toBeCloseTo(-60);
    expect(result.presumedResolvedMonthlyUsd).toBe(15);
    expect(result.resolvedFindings).toEqual([{ id: 'vol-1', kind: 'ebs-volume', monthlyCostUsd: 15 }]);
    expect(result.newFindings).toEqual([]);
    expect(result.regionsChanged).toBe(false);
  });

  it('reports new findings that appeared since the older snapshot', () => {
    const older = wasteReport({ totalWasteMonthlyUsd: 0, findings: [] });
    const newer = wasteReport({ totalWasteMonthlyUsd: 8, findings: [finding('vol-new', 8)] });

    const result = compareCloudCostSnapshots(older, newer);

    expect(result.newFindings).toEqual([{ id: 'vol-new', kind: 'ebs-volume', monthlyCostUsd: 8 }]);
    expect(result.presumedResolvedMonthlyUsd).toBe(0);
  });

  it('returns a null deltaPercent when the older total was $0 (division by zero has no meaningful percentage)', () => {
    const older = wasteReport({ totalWasteMonthlyUsd: 0 });
    const newer = wasteReport({ totalWasteMonthlyUsd: 12 });

    expect(compareCloudCostSnapshots(older, newer).deltaPercent).toBeNull();
  });

  it('flags when the two runs scanned different regions', () => {
    const older = wasteReport({ meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-07-25T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false } });
    const newer = wasteReport({ meta: { accountId: '123456789012', regions: ['us-east-1', 'eu-west-1'], generatedAt: '2026-07-30T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false } });

    expect(compareCloudCostSnapshots(older, newer).regionsChanged).toBe(true);
  });

  it('does not flag regionsChanged when the same regions are scanned in a different order', () => {
    const older = wasteReport({ meta: { accountId: '123456789012', regions: ['eu-west-1', 'us-east-1'], generatedAt: '2026-07-25T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false } });
    const newer = wasteReport({ meta: { accountId: '123456789012', regions: ['us-east-1', 'eu-west-1'], generatedAt: '2026-07-30T00:00:00.000Z', pricesAsOf: '2026-06', pricesStale: false } });

    expect(compareCloudCostSnapshots(older, newer).regionsChanged).toBe(false);
  });
});

describe('compareHygieneSnapshots', () => {
  function report(overrides: Partial<DeadResourcesReportDto> = {}): DeadResourcesReportDto {
    return {
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-07-01T00:00:00.000Z' },
      disclaimer: '',
      countBySeverity: { info: 0, warning: 0, critical: 0 },
      findings: [],
      scanErrors: [],
      ...overrides,
    };
  }

  function hygieneFinding(id: string, severity: 'info' | 'warning' | 'critical') {
    return { id, kind: 'ec2-keypair-unused', region: 'us-east-1', accountId: '123456789012', detectedAt: '2026-06-01T00:00:00.000Z', tags: {}, hygieneReason: 'unused', severity };
  }

  it('reports resolved/new findings and both severity breakdowns', () => {
    const older = report({
      countBySeverity: { info: 2, warning: 0, critical: 0 },
      findings: [hygieneFinding('kp-1', 'info'), hygieneFinding('kp-2', 'info')],
    });
    const newer = report({
      countBySeverity: { info: 1, warning: 0, critical: 0 },
      findings: [hygieneFinding('kp-2', 'info')],
    });

    const result = compareHygieneSnapshots('dead-resources', older, newer);

    expect(result.domain).toBe('dead-resources');
    expect(result.olderCountBySeverity).toEqual({ info: 2, warning: 0, critical: 0 });
    expect(result.newerCountBySeverity).toEqual({ info: 1, warning: 0, critical: 0 });
    expect(result.resolvedFindings).toEqual([{ id: 'kp-1', kind: 'ec2-keypair-unused', severity: 'info' }]);
    expect(result.newFindings).toEqual([]);
  });
});
