// SPDX-License-Identifier: Apache-2.0
import { toResourceSecurityReportDto } from './resource-security-report.dto';
import { RESOURCE_SECURITY_REPORT_DISCLAIMER } from '../constants/report-disclaimer';
import { AwsRegion, Ec2SecurityGroupOpenIngress, IamRootMfaDisabled } from 'resource-security-domain';
import type { ResourceSecuritySummary } from 'resource-security-domain';

const region = AwsRegion.create('us-east-1');

const openIngress = new Ec2SecurityGroupOpenIngress({
  groupId: 'sg-1',
  groupName: 'default',
  region,
  accountId: '123456789012',
  matchedRules: ['22/tcp from 0.0.0.0/0'],
  detectedAt: new Date('2026-06-09T00:00:00Z'),
  tags: { Environment: 'prod' },
});

// Account-wide finding (IAM root): no `region` getter — exercises the `?? null` path.
const rootMfa = new IamRootMfaDisabled({
  accountId: '123456789012',
  mfaEnabled: false,
  detectedAt: new Date('2026-06-09T00:00:00Z'),
  tags: {},
});

const summary: ResourceSecuritySummary = {
  findings: [openIngress, rootMfa],
  countBySeverity: { info: 0, warning: 0, critical: 2 },
  scanErrors: [{ kind: 'cloudtrail-not-multiregion', region: 'eu-west-1', error: new Error('throttled') }],
};

const meta = { accountId: '123456789012', regions: ['us-east-1'], generatedAt: new Date('2026-06-12T10:00:00Z') };

describe('toResourceSecurityReportDto', () => {
  it('produces a JSON-serializable report (round-trip safe)', () => {
    // Regression: `findings` holds raw entity instances whose data lives
    // behind getters (private `props`) — JSON.stringify on those directly
    // (skipping this DTO) silently drops every field but the internal
    // `_id`/`props`. This is the check that catches that class of bug.
    const dto = toResourceSecurityReportDto(summary, meta);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it('maps meta, disclaimer and countBySeverity', () => {
    const dto = toResourceSecurityReportDto(summary, meta);
    expect(dto.meta).toEqual({
      accountId: '123456789012',
      regions: ['us-east-1'],
      generatedAt: '2026-06-12T10:00:00.000Z',
    });
    expect(dto.disclaimer).toBe(RESOURCE_SECURITY_REPORT_DISCLAIMER);
    expect(dto.countBySeverity).toEqual({ info: 0, warning: 0, critical: 2 });
  });

  it('maps a regional finding with its region code', () => {
    const dto = toResourceSecurityReportDto(summary, meta);
    expect(dto.findings.find((f) => f.id === 'sg-1')).toEqual({
      id: 'sg-1',
      kind: 'ec2-security-group-open-ingress',
      region: 'us-east-1',
      accountId: '123456789012',
      detectedAt: '2026-06-09T00:00:00.000Z',
      tags: { Environment: 'prod' },
      riskReason: expect.any(String),
      severity: 'critical',
    });
  });

  it('maps an account-wide finding with region: null, not omitted or undefined', () => {
    const dto = toResourceSecurityReportDto(summary, meta);
    const found = dto.findings.find((f) => f.kind === 'iam-root-mfa-disabled');
    expect(found?.region).toBeNull();
  });

  it('maps scan errors to plain messages', () => {
    const dto = toResourceSecurityReportDto(summary, meta);
    expect(dto.scanErrors).toEqual([{ kind: 'cloudtrail-not-multiregion', region: 'eu-west-1', message: 'throttled' }]);
  });
});
