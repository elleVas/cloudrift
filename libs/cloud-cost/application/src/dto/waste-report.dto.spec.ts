import { toWasteReportDto } from './waste-report.dto';
import { AwsRegion, EbsVolume, ElasticIp } from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';

const region = AwsRegion.create('us-east-1');

const volume = new EbsVolume({
  volumeId: 'vol-1',
  region,
  accountId: '123456789012',
  sizeGb: 100,
  volumeType: 'gp3',
  state: 'available',
  createTime: new Date('2025-01-01T00:00:00Z'),
  detectedAt: new Date('2026-06-09T00:00:00Z'),
  tags: { Environment: 'staging' },
  monthlyCostUsd: 8,
});

const ip = new ElasticIp({
  allocationId: 'eipalloc-1',
  publicIp: '1.2.3.4',
  region,
  accountId: '123456789012',
  detectedAt: new Date('2026-06-09T00:00:00Z'),
  tags: {},
  monthlyCostUsd: 3.6,
});

const summary: WastedResourcesSummary = {
  findings: [volume, ip],
  totalMonthlyCostUsd: 11.6,
  scanErrors: [
    { kind: 'nat-gateway', region: 'eu-west-1', error: new Error('throttled') },
  ],
};

const meta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-06-12T10:00:00Z'),
  pricesAsOf: '2025-06',
};

describe('toWasteReportDto', () => {
  it('produces a JSON-serializable report (round-trip safe)', () => {
    const dto = toWasteReportDto(summary, meta);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it('maps meta, totals and counts', () => {
    const dto = toWasteReportDto(summary, meta);
    expect(dto.meta).toEqual({
      accountId: '123456789012',
      regions: ['us-east-1'],
      generatedAt: '2026-06-12T10:00:00.000Z',
      pricesAsOf: '2025-06',
    });
    expect(dto.totalMonthlyCostUsd).toBe(11.6);
    expect(dto.totalAnnualCostUsd).toBe(139.2);
    expect(dto.resourceCount).toBe(2);
  });

  it('builds the per-kind breakdown only for kinds with findings', () => {
    const dto = toWasteReportDto(summary, meta);
    expect(dto.breakdown).toEqual([
      { kind: 'ebs-volume', label: 'EBS Volumes', count: 1, monthlyCostUsd: 8 },
      { kind: 'elastic-ip', label: 'Elastic IPs', count: 1, monthlyCostUsd: 3.6 },
    ]);
  });

  it('maps findings with ISO dates and waste reasons', () => {
    const dto = toWasteReportDto(summary, meta);
    const volDto = dto.findings.find((f) => f.id === 'vol-1');
    expect(volDto).toEqual({
      id: 'vol-1',
      kind: 'ebs-volume',
      region: 'us-east-1',
      accountId: '123456789012',
      detectedAt: '2026-06-09T00:00:00.000Z',
      wasteReason: 'unattached',
      description: '100 GB gp3 unattached EBS',
      monthlyCostUsd: 8,
      tags: { Environment: 'staging' },
    });
  });

  it('maps scan errors to plain messages', () => {
    const dto = toWasteReportDto(summary, meta);
    expect(dto.scanErrors).toEqual([
      { kind: 'nat-gateway', region: 'eu-west-1', message: 'throttled' },
    ]);
  });
});
