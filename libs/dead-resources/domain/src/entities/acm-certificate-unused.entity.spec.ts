// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { AcmCertificateUnused } from './acm-certificate-unused.entity';
import type { AcmCertificateUnusedProps } from './acm-certificate-unused.entity';

function makeCert(overrides: Partial<AcmCertificateUnusedProps> = {}): AcmCertificateUnused {
  return new AcmCertificateUnused({
    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123',
    domainName: 'old.example.com',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('AcmCertificateUnused', () => {
  it('exposes correct id and fields', () => {
    const cert = makeCert();
    expect(cert.id).toBe('arn:aws:acm:us-east-1:123456789012:certificate/abc-123');
    expect(cert.domainName).toBe('old.example.com');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const cert = makeCert();
    expect(cert.kind).toBe('acm-certificate-unused');
    expect(cert.hygieneReason).toContain('not in use');
    expect(cert.severity).toBe('info');
  });
});
