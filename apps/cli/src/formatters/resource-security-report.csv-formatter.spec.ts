// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, Ec2SecurityGroupOpenIngress } from 'resource-security-domain';
import type { ResourceSecuritySummary } from 'resource-security-domain';
import type { ResourceSecurityReportMeta } from 'resource-security-application';
import { formatResourceSecurityReportAsCsv } from './resource-security-report.csv-formatter';

const region = AwsRegion.create('us-east-1');
const meta: ResourceSecurityReportMeta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-06-16'),
};

function summaryOf(groupId: string): ResourceSecuritySummary {
  const group = new Ec2SecurityGroupOpenIngress({
    groupId,
    groupName: 'my-sg',
    region,
    accountId: '123456789012',
    matchedRules: ['22/tcp from 0.0.0.0/0'],
    detectedAt: new Date('2026-06-16'),
    tags: {},
  });
  return { findings: [group], countBySeverity: { info: 0, warning: 0, critical: 1 }, scanErrors: [] };
}

describe('formatResourceSecurityReportAsCsv', () => {
  it('emits a header row followed by one row per finding, with a consoleUrl column', () => {
    const csv = formatResourceSecurityReportAsCsv(summaryOf('sg-abc123'), meta);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('id,kind,region,accountId,detectedAt,tags,riskReason,severity,consoleUrl');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('sg-abc123');
    expect(lines[1]).toContain(
      'https://console.aws.amazon.com/vpc/home?region=us-east-1#SecurityGroups:groupId=sg-abc123',
    );
  });
});
