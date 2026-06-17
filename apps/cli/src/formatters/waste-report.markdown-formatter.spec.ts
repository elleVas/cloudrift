import { AwsRegion, EbsVolume, Gp2Volume } from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { formatWasteReportAsMarkdown } from './waste-report.markdown-formatter';

const region = AwsRegion.create('us-east-1');

const meta: WasteReportMeta = {
  accountId: '123456789012',
  regions: ['us-east-1', 'eu-west-1'],
  generatedAt: new Date('2026-06-16T10:00:00Z'),
  pricesAsOf: '2025-06',
};

function makeVolume(id: string, monthlyCostUsd: number): EbsVolume {
  return new EbsVolume({
    volumeId: id,
    region,
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'available',
    createTime: new Date('2025-01-01'),
    detectedAt: meta.generatedAt,
    tags: {},
    monthlyCostUsd,
  });
}

function makeGp2(id: string, monthlyCostUsd: number): Gp2Volume {
  return new Gp2Volume({
    volumeId: id,
    region,
    accountId: '123456789012',
    sizeGb: 200,
    createTime: new Date('2025-01-01'),
    detectedAt: meta.generatedAt,
    tags: {},
    monthlyCostUsd,
  });
}

describe('formatWasteReportAsMarkdown', () => {
  it('renders the empty case', () => {
    const summary: WastedResourcesSummary = {
      findings: [],
      totalWasteMonthlyUsd: 0,
      totalOptimizationMonthlyUsd: 0,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    expect(md).toContain('No wasted resources found');
    expect(md).toContain('prices as of 2025-06');
  });

  it('renders headline (waste), breakdown, details and recommendations', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-aaa', 8), makeVolume('vol-bbb', 4)],
      totalWasteMonthlyUsd: 12,
      totalOptimizationMonthlyUsd: 0,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    expect(md).toContain('$12.00/month');
    expect(md).toContain('$144.00/year');
    expect(md).toContain('across 2 resource(s)');
    expect(md).toContain('account `123456789012`');
    expect(md).toContain('us-east-1, eu-west-1');
    expect(md).toContain('| **Total waste** | **2** | **$12.00** |');
    expect(md).toContain('<details>');
    expect(md).toContain('vol-aaa');
    const recIndexAaa = md.indexOf('Delete unattached EBS vol-aaa');
    const recIndexBbb = md.indexOf('Delete unattached EBS vol-bbb');
    expect(recIndexAaa).toBeGreaterThan(-1);
    expect(recIndexAaa).toBeLessThan(recIndexBbb);
  });

  it('puts optimization findings in a separate section, out of the waste total', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-waste', 30), makeGp2('vol-gp2', 4)],
      totalWasteMonthlyUsd: 30,
      totalOptimizationMonthlyUsd: 4,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    // headline is waste only
    expect(md).toContain('$30.00/month** of waste');
    expect(md).toContain('across 1 resource(s)');
    // optimization is a separate section with its own total
    expect(md).toContain('### Optimization opportunities');
    expect(md).toContain('| **Total optimization** | **1** | **$4.00** |');
    expect(md).toContain('without deleting');
  });

  it('flags when the WASTE total is over the configured threshold', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-aaa', 600)],
      totalWasteMonthlyUsd: 600,
      totalOptimizationMonthlyUsd: 0,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta, { costAlertThresholdUsd: 500 });

    expect(md).toContain('Over the $500.00/mo waste threshold');
    expect(md).toContain('pipeline should fail');
  });

  it('shows "under threshold" when the waste total is within budget', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-aaa', 100)],
      totalWasteMonthlyUsd: 100,
      totalOptimizationMonthlyUsd: 0,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta, { costAlertThresholdUsd: 500 });

    expect(md).toContain('Under the $500.00/mo waste threshold');
  });

  it('reports scan errors as partial results', () => {
    const summary: WastedResourcesSummary = {
      findings: [],
      totalWasteMonthlyUsd: 0,
      totalOptimizationMonthlyUsd: 0,
      scanErrors: [
        { kind: 'rds-instance', region: 'eu-west-1', error: new Error('AccessDenied') },
      ],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    expect(md).toContain('Partial results');
    expect(md).toContain('RDS Instances in eu-west-1: AccessDenied');
  });
});
