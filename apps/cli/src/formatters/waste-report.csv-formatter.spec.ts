// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, EbsVolume } from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { formatWasteReportAsCsv } from './waste-report.csv-formatter';

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
    tags: { env: 'prod' },
    monthlyCostUsd: 8,
    wasteReason: 'unattached',
  });
  return { findings: [volume], totalWasteMonthlyUsd: 8, totalOptimizationMonthlyUsd: 0, scanErrors: [] };
}

describe('formatWasteReportAsCsv', () => {
  it('emits a header row followed by one row per finding, with a consoleUrl column', () => {
    const csv = formatWasteReportAsCsv(summaryOf('vol-abc123'), meta);
    const lines = csv.split('\n');

    expect(lines[0]).toBe(
      'id,kind,category,estimated,region,accountId,detectedAt,wasteReason,description,monthlyCostUsd,tags,userName,consoleUrl,pricesAsOf,pricesStale',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('vol-abc123');
    expect(lines[1]).toContain('https://console.aws.amazon.com/ec2/home?region=us-east-1#Volumes:volumeId=vol-abc123');
  });

  it('repeats pricesAsOf/pricesStale on every row', () => {
    const csv = formatWasteReportAsCsv(summaryOf('vol-abc123'), meta);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('2026-06,false');
  });

  it('flags pricesStale true when the price list is over 100 days old', () => {
    const staleMeta: WasteReportMeta = { ...meta, pricesAsOf: '2025-06' };
    const csv = formatWasteReportAsCsv(summaryOf('vol-abc123'), staleMeta);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('2025-06,true');
  });

  it('JSON-encodes the tags map into a single quoted field', () => {
    const csv = formatWasteReportAsCsv(summaryOf('vol-1'), meta);
    expect(csv).toContain('"{""env"":""prod""}"');
  });
});
