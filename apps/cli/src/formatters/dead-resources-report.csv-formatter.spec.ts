// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, Ec2SecurityGroupUnused } from 'dead-resources-domain';
import type { DeadResourcesSummary } from 'dead-resources-domain';
import type { DeadResourcesReportMeta } from 'dead-resources-application';
import { formatDeadResourcesReportAsCsv } from './dead-resources-report.csv-formatter';

const region = AwsRegion.create('us-east-1');
const meta: DeadResourcesReportMeta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-06-16'),
};

function summaryOf(groupId: string): DeadResourcesSummary {
  const group = new Ec2SecurityGroupUnused({
    groupId,
    groupName: 'my-sg',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-06-16'),
    tags: {},
  });
  return { findings: [group], countBySeverity: { info: 0, warning: 1, critical: 0 }, scanErrors: [] };
}

describe('formatDeadResourcesReportAsCsv', () => {
  it('emits a header row followed by one row per finding, with a consoleUrl column', () => {
    const csv = formatDeadResourcesReportAsCsv(summaryOf('sg-abc123'), meta);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('id,kind,region,accountId,detectedAt,tags,hygieneReason,severity,consoleUrl');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('sg-abc123');
    expect(lines[1]).toContain(
      'https://console.aws.amazon.com/vpc/home?region=us-east-1#SecurityGroups:groupId=sg-abc123',
    );
  });

  it('renders a null region (global-scope finding) as an empty field, not the literal "null"', () => {
    const roleFinding = {
      id: 'AROAEXAMPLE',
      kind: 'iam-role-unused',
      region: undefined,
      accountId: '123456789012',
      detectedAt: new Date('2026-06-16'),
      tags: {},
      hygieneReason: 'not assumed in 90 days',
      severity: 'warning' as const,
    };
    const summary: DeadResourcesSummary = {
      findings: [roleFinding],
      countBySeverity: { info: 0, warning: 1, critical: 0 },
      scanErrors: [],
    };

    const csv = formatDeadResourcesReportAsCsv(summary, meta);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('AROAEXAMPLE,iam-role-unused,,123456789012,2026-06-16T00:00:00.000Z,{},not assumed in 90 days,warning,');
  });
});
