// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { AcmCertificateUnused } from '../entities/acm-certificate-unused.entity';
import type { AcmCertificateUnusedProps } from '../entities/acm-certificate-unused.entity';
import { AcmCertificateUnusedPolicy } from './acm-certificate-unused.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeCert(overrides: Partial<AcmCertificateUnusedProps> = {}): AcmCertificateUnused {
  return new AcmCertificateUnused({
    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/1',
    domainName: 'example.com',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('AcmCertificateUnusedPolicy', () => {
  const policy = new AcmCertificateUnusedPolicy();

  it('flags an old unused certificate', () => {
    const verdict = policy.evaluate(makeCert(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('not in use');
  });

  it('does not flag a certificate created within the grace period', () => {
    const verdict = policy.evaluate(makeCert({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a certificate created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeCert({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a certificate carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeCert({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
