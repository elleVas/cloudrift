// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { AcmCertificateExpiring } from '../entities/acm-certificate-expiring.entity';
import { AcmCertificateExpiringPolicy, DEFAULT_CERT_EXPIRY_WARNING_DAYS } from './acm-certificate-expiring.policy';

const region = AwsRegion.create('us-east-1');
const now = new Date('2026-07-31');

function makeFinding(notAfter: Date, tags: Record<string, string> = {}): AcmCertificateExpiring {
  return new AcmCertificateExpiring({
    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc',
    domainName: 'example.com',
    notAfter,
    region,
    accountId: '123456789012',
    detectedAt: now,
    tags,
  });
}

describe('AcmCertificateExpiringPolicy', () => {
  const policy = new AcmCertificateExpiringPolicy();

  it('does not flag a certificate expiring well outside the warning window', () => {
    const farFuture = new Date(now.getTime() + (DEFAULT_CERT_EXPIRY_WARNING_DAYS + 10) * 24 * 60 * 60 * 1000);
    expect(policy.evaluate(makeFinding(farFuture), now).flagged).toBe(false);
  });

  it('flags a certificate expiring within the warning window', () => {
    const soon = new Date(now.getTime() + (DEFAULT_CERT_EXPIRY_WARNING_DAYS - 5) * 24 * 60 * 60 * 1000);
    expect(policy.evaluate(makeFinding(soon), now).flagged).toBe(true);
  });

  it('flags an already-expired certificate', () => {
    const past = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    expect(policy.evaluate(makeFinding(past), now).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const soon = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    expect(policy.evaluate(makeFinding(soon, { 'cloudrift:ignore': 'true' }), now).flagged).toBe(false);
  });

  it('honors a custom warning threshold', () => {
    const customPolicy = new AcmCertificateExpiringPolicy({}, 60);
    const in40Days = new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000);
    expect(customPolicy.evaluate(makeFinding(in40Days), now).flagged).toBe(true);
  });
});
