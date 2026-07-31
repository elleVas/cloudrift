// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { AcmCertificateExpiring } from './acm-certificate-expiring.entity';
import type { AcmCertificateExpiringProps } from './acm-certificate-expiring.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<AcmCertificateExpiringProps> = {}): AcmCertificateExpiring {
  return new AcmCertificateExpiring({
    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc',
    domainName: 'example.com',
    notAfter: new Date('2026-08-15'),
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('AcmCertificateExpiring', () => {
  it('exposes id (certificateArn), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('arn:aws:acm:us-east-1:123456789012:certificate/abc');
    expect(finding.kind).toBe('acm-certificate-expiring');
    expect(finding.severity).toBe('warning');
  });

  it('reports days left when not yet expired', () => {
    const finding = makeFinding({ notAfter: new Date('2026-08-15'), detectedAt: new Date('2026-07-31') });
    expect(finding.riskReason).toBe('expires in 15d');
  });

  it('reports days-ago when already expired', () => {
    const finding = makeFinding({ notAfter: new Date('2026-07-20'), detectedAt: new Date('2026-07-31') });
    expect(finding.riskReason).toBe('expired 11d ago');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ domainName: 'api.example.com', tags: { env: 'prod' } });
    expect(finding.domainName).toBe('api.example.com');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
  });
});
