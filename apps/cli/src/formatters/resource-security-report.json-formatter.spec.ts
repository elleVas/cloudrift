// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, Ec2SecurityGroupOpenIngress } from 'resource-security-domain';
import type { ResourceSecuritySummary } from 'resource-security-domain';
import type { ResourceSecurityReportMeta } from 'resource-security-application';
import { formatResourceSecurityReportAsJson } from './resource-security-report.json-formatter';

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

describe('formatResourceSecurityReportAsJson', () => {
  it('adds a consoleUrl per finding, derived from kind/id/region', () => {
    const dto = JSON.parse(formatResourceSecurityReportAsJson(summaryOf('sg-abc123'), meta));

    expect(dto.findings).toHaveLength(1);
    expect(dto.findings[0].consoleUrl).toBe(
      'https://console.aws.amazon.com/vpc/home?region=us-east-1#SecurityGroups:groupId=sg-abc123',
    );
  });
});
