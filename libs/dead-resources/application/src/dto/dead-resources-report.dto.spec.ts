// SPDX-License-Identifier: Apache-2.0
import { toDeadResourceReportDto } from './dead-resources-report.dto';
import { DEAD_RESOURCES_REPORT_DISCLAIMER } from '../constants/report-disclaimer';
import { AwsRegion, Ec2KeyPairUnused, IamUserInactive } from 'dead-resources-domain';
import type { DeadResourcesSummary } from 'dead-resources-domain';

const region = AwsRegion.create('us-east-1');

const keyPair = new Ec2KeyPairUnused({
  keyPairId: 'key-1',
  keyName: 'my-key',
  region,
  accountId: '123456789012',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  detectedAt: new Date('2026-06-09T00:00:00Z'),
  tags: { Environment: 'staging' },
});

// Global-scope finding (IAM): no `region` getter — exercises the `?? null` path.
const iamUser = new IamUserInactive({
  userId: 'AIDA1234567890',
  userName: 'jdoe',
  arn: 'arn:aws:iam::123456789012:user/jdoe',
  accountId: '123456789012',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  lastActivityAt: undefined,
  detectedAt: new Date('2026-06-09T00:00:00Z'),
  tags: {},
});

const summary: DeadResourcesSummary = {
  findings: [keyPair, iamUser],
  countBySeverity: { info: 1, warning: 1, critical: 0 },
  scanErrors: [{ kind: 'ec2-keypair-unused', region: 'eu-west-1', error: new Error('throttled') }],
};

const meta = { accountId: '123456789012', regions: ['us-east-1'], generatedAt: new Date('2026-06-12T10:00:00Z') };

describe('toDeadResourceReportDto', () => {
  it('produces a JSON-serializable report (round-trip safe)', () => {
    // Regression: `findings` holds raw entity instances whose data lives
    // behind getters (private `props`) — JSON.stringify on those directly
    // (skipping this DTO) silently drops every field but the internal
    // `_id`/`props`. This is the check that catches that class of bug.
    const dto = toDeadResourceReportDto(summary, meta);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it('maps meta, disclaimer and countBySeverity', () => {
    const dto = toDeadResourceReportDto(summary, meta);
    expect(dto.meta).toEqual({
      accountId: '123456789012',
      regions: ['us-east-1'],
      generatedAt: '2026-06-12T10:00:00.000Z',
    });
    expect(dto.disclaimer).toBe(DEAD_RESOURCES_REPORT_DISCLAIMER);
    expect(dto.countBySeverity).toEqual({ info: 1, warning: 1, critical: 0 });
  });

  it('maps a regional finding with its region code', () => {
    const dto = toDeadResourceReportDto(summary, meta);
    expect(dto.findings.find((f) => f.id === 'key-1')).toEqual({
      id: 'key-1',
      kind: 'ec2-keypair-unused',
      region: 'us-east-1',
      accountId: '123456789012',
      detectedAt: '2026-06-09T00:00:00.000Z',
      tags: { Environment: 'staging' },
      hygieneReason: expect.any(String),
      severity: 'info',
    });
  });

  it('maps a global-scope finding with region: null, not omitted or undefined', () => {
    const dto = toDeadResourceReportDto(summary, meta);
    const found = dto.findings.find((f) => f.kind === 'iam-user-inactive');
    expect(found?.region).toBeNull();
  });

  it('maps scan errors to plain messages', () => {
    const dto = toDeadResourceReportDto(summary, meta);
    expect(dto.scanErrors).toEqual([{ kind: 'ec2-keypair-unused', region: 'eu-west-1', message: 'throttled' }]);
  });
});
