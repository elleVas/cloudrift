// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { groupByKind } from './group-by-kind';
import { RESOURCE_SECURITY_KINDS, type SecurityFinding } from './resource-security';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: 'finding-1',
    kind: 'iam-root-mfa-disabled',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-27'),
    tags: {},
    riskReason: 'no MFA device registered',
    severity: 'critical',
    ...overrides,
  };
}

describe('groupByKind', () => {
  it('buckets findings under their own kind', () => {
    const rootMfa = makeFinding({ id: 'a', kind: 'iam-root-mfa-disabled' });
    const s3Public = makeFinding({ id: 'b', kind: 's3-bucket-public' });

    const grouped = groupByKind([rootMfa, s3Public]);

    expect(grouped['iam-root-mfa-disabled']).toEqual([rootMfa]);
    expect(grouped['s3-bucket-public']).toEqual([s3Public]);
  });

  it('returns an empty array for every kind with no findings', () => {
    const grouped = groupByKind([]);

    for (const kind of RESOURCE_SECURITY_KINDS) {
      expect(grouped[kind]).toEqual([]);
    }
  });

  it('preserves insertion order within a bucket', () => {
    const first = makeFinding({ id: 'a' });
    const second = makeFinding({ id: 'b' });

    const grouped = groupByKind([first, second]);

    expect(grouped['iam-root-mfa-disabled']).toEqual([first, second]);
  });
});
