// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, EbsVolume } from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { formatWasteReportAsTable } from './waste-report.table-formatter';

const region = AwsRegion.create('us-east-1');

function summaryOf(volumeId: string): WastedResourcesSummary {
  const volume = new EbsVolume({
    volumeId,
    region,
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'available',
    createTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-16'),
    tags: {},
    monthlyCostUsd: 8,
    wasteReason: 'unattached',
  });
  return { findings: [volume], totalWasteMonthlyUsd: 8, totalOptimizationMonthlyUsd: 0, scanErrors: [] };
}

describe('formatWasteReportAsTable', () => {
  it('warns when the price list is over 100 days old', () => {
    const meta: WasteReportMeta = {
      accountId: '123456789012',
      regions: ['us-east-1'],
      generatedAt: new Date('2026-06-16'),
      pricesAsOf: '2025-06',
    };

    const table = formatWasteReportAsTable(summaryOf('vol-abc123'), meta);

    expect(table).toContain('Price list is over 100 days old');
    expect(table).toContain('--live-pricing');
  });

  it('does not warn when the price list is fresh', () => {
    const meta: WasteReportMeta = {
      accountId: '123456789012',
      regions: ['us-east-1'],
      generatedAt: new Date('2026-06-16'),
      pricesAsOf: '2026-06',
    };

    const table = formatWasteReportAsTable(summaryOf('vol-abc123'), meta);

    expect(table).not.toContain('Price list is over');
  });
});
