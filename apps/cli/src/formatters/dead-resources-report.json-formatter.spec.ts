// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, Ec2SecurityGroupUnused } from 'dead-resources-domain';
import type { DeadResourcesSummary } from 'dead-resources-domain';
import type { DeadResourcesReportMeta } from 'dead-resources-application';
import { formatDeadResourcesReportAsJson } from './dead-resources-report.json-formatter';

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

describe('formatDeadResourcesReportAsJson', () => {
  it('adds a consoleUrl per finding, derived from kind/id/region', () => {
    const dto = JSON.parse(formatDeadResourcesReportAsJson(summaryOf('sg-abc123'), meta));

    expect(dto.findings).toHaveLength(1);
    expect(dto.findings[0].consoleUrl).toBe(
      'https://console.aws.amazon.com/vpc/home?region=us-east-1#SecurityGroups:groupId=sg-abc123',
    );
  });

  it('leaves consoleUrl undefined for kinds with no derivable link (opaque IAM id)', () => {
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

    const dto = JSON.parse(formatDeadResourcesReportAsJson(summary, meta));

    expect(dto.findings[0].consoleUrl).toBeUndefined();
  });
});
