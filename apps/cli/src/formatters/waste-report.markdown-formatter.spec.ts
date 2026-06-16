import { AwsRegion, EbsVolume } from 'cloud-cost-domain';
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

describe('formatWasteReportAsMarkdown', () => {
  it('renders the empty case', () => {
    const summary: WastedResourcesSummary = {
      findings: [],
      totalMonthlyCostUsd: 0,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    expect(md).toContain('No wasted resources found');
    expect(md).toContain('prices as of 2025-06');
  });

  it('renders headline, breakdown, details and recommendations', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-aaa', 8), makeVolume('vol-bbb', 4)],
      totalMonthlyCostUsd: 12,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    // headline + annualized
    expect(md).toContain('$12.00/month');
    expect(md).toContain('$144.00/year');
    expect(md).toContain('across 2 resource(s)');
    // account + regions context
    expect(md).toContain('account `123456789012`');
    expect(md).toContain('us-east-1, eu-west-1');
    // breakdown total row
    expect(md).toContain('| **Total** | **2** | **$12.00** |');
    // collapsible details + per-finding row
    expect(md).toContain('<details>');
    expect(md).toContain('vol-aaa');
    // recommendation present, sorted by cost (vol-aaa first)
    const recIndexAaa = md.indexOf('Delete unattached EBS vol-aaa');
    const recIndexBbb = md.indexOf('Delete unattached EBS vol-bbb');
    expect(recIndexAaa).toBeGreaterThan(-1);
    expect(recIndexAaa).toBeLessThan(recIndexBbb);
  });

  it('flags when the total is over the configured threshold', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-aaa', 600)],
      totalMonthlyCostUsd: 600,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta, { costAlertThresholdUsd: 500 });

    expect(md).toContain('Over the $500.00/mo threshold');
    expect(md).toContain('pipeline should fail');
  });

  it('shows "under threshold" when the total is within budget', () => {
    const summary: WastedResourcesSummary = {
      findings: [makeVolume('vol-aaa', 100)],
      totalMonthlyCostUsd: 100,
      scanErrors: [],
    };

    const md = formatWasteReportAsMarkdown(summary, meta, { costAlertThresholdUsd: 500 });

    expect(md).toContain('Under the $500.00/mo threshold');
  });

  it('reports scan errors as partial results', () => {
    const summary: WastedResourcesSummary = {
      findings: [],
      totalMonthlyCostUsd: 0,
      scanErrors: [
        { kind: 'rds-instance', region: 'eu-west-1', error: new Error('AccessDenied') },
      ],
    };

    const md = formatWasteReportAsMarkdown(summary, meta);

    expect(md).toContain('Partial results');
    expect(md).toContain('RDS Instances in eu-west-1: AccessDenied');
  });
});
