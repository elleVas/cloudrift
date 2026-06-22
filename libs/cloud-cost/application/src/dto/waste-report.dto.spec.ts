import { toWasteReportDto } from './waste-report.dto';
import { REPORT_CONTACT, REPORT_DISCLAIMER } from '../constants/report-disclaimer';
import { AwsRegion, EbsVolume, ElasticIp, Gp2Volume } from 'cloud-cost-domain';
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
  totalWasteMonthlyUsd: 11.6,
  totalOptimizationMonthlyUsd: 0,
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
    expect(dto.disclaimer).toBe(REPORT_DISCLAIMER);
    expect(dto.contact).toEqual(REPORT_CONTACT);
    expect(dto.totalWasteMonthlyUsd).toBe(11.6);
    expect(dto.totalWasteAnnualUsd).toBe(139.2);
    expect(dto.totalOptimizationMonthlyUsd).toBe(0);
    expect(dto.wasteCount).toBe(2);
    expect(dto.optimizationCount).toBe(0);
  });

  it('builds the per-kind breakdown only for kinds with findings', () => {
    const dto = toWasteReportDto(summary, meta);
    expect(dto.breakdown).toEqual([
      { kind: 'ebs-volume', label: 'EBS Volumes', category: 'waste', estimated: false, count: 1, monthlyCostUsd: 8 },
      { kind: 'elastic-ip', label: 'Elastic IPs', category: 'waste', estimated: false, count: 1, monthlyCostUsd: 3.6 },
    ]);
  });

  it('maps findings with ISO dates, category and waste reasons', () => {
    const dto = toWasteReportDto(summary, meta);
    const volDto = dto.findings.find((f) => f.id === 'vol-1');
    expect(volDto).toEqual({
      id: 'vol-1',
      kind: 'ebs-volume',
      category: 'waste',
      estimated: false,
      region: 'us-east-1',
      accountId: '123456789012',
      detectedAt: '2026-06-09T00:00:00.000Z',
      wasteReason: 'unattached',
      description: '100 GB gp3 unattached EBS',
      monthlyCostUsd: 8,
      tags: { Environment: 'staging' },
    });
  });

  it('classifies gp2→gp3 as an optimization, separate from the waste total', () => {
    const gp2 = new Gp2Volume({
      volumeId: 'vol-gp2',
      region,
      accountId: '123456789012',
      sizeGb: 200,
      createTime: new Date('2025-01-01T00:00:00Z'),
      detectedAt: new Date('2026-06-09T00:00:00Z'),
      tags: {},
      monthlyCostUsd: 4,
    });
    const dto = toWasteReportDto(
      { findings: [volume, gp2], totalWasteMonthlyUsd: 8, totalOptimizationMonthlyUsd: 4, scanErrors: [] },
      meta,
    );

    expect(dto.totalWasteMonthlyUsd).toBe(8);
    expect(dto.totalOptimizationMonthlyUsd).toBe(4);
    expect(dto.wasteCount).toBe(1);
    expect(dto.optimizationCount).toBe(1);
    const gp2Dto = dto.findings.find((f) => f.id === 'vol-gp2');
    expect(gp2Dto?.category).toBe('optimization');
  });

  it('maps scan errors to plain messages', () => {
    const dto = toWasteReportDto(summary, meta);
    expect(dto.scanErrors).toEqual([
      { kind: 'nat-gateway', region: 'eu-west-1', message: 'throttled' },
    ]);
  });
});
