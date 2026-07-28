// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, EbsVolume } from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { formatWasteReportAsJson } from './waste-report.json-formatter';

const region = AwsRegion.create('us-east-1');
const meta: WasteReportMeta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-06-16'),
  pricesAsOf: '2026-06',
};

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

describe('formatWasteReportAsJson', () => {
  it('adds a consoleUrl per finding, derived from kind/id/region', () => {
    const dto = JSON.parse(formatWasteReportAsJson(summaryOf('vol-abc123'), meta));

    expect(dto.findings).toHaveLength(1);
    expect(dto.findings[0].consoleUrl).toBe(
      'https://console.aws.amazon.com/ec2/home?region=us-east-1#Volumes:volumeId=vol-abc123',
    );
  });
});
