// SPDX-License-Identifier: Apache-2.0
import { ACMClient, ListCertificatesCommand, DescribeCertificateCommand } from '@aws-sdk/client-acm';
import { AwsAcmCertificateExpiringScanner } from './aws-acm-certificate-expiring.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-acm');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ACMClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsAcmCertificateExpiringScanner();
const arn = 'arn:aws:acm:us-east-1:123456789012:certificate/abc';

describe('AwsAcmCertificateExpiringScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('acm-certificate-expiring');
  });

  it('flags an issued certificate expiring soon', async () => {
    const notAfter = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    mockSend
      .mockResolvedValueOnce({ CertificateSummaryList: [{ CertificateArn: arn, DomainName: 'example.com' }] })
      .mockResolvedValueOnce({ Certificate: { Status: 'ISSUED', NotAfter: notAfter, DomainName: 'example.com' } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag an issued certificate expiring far in the future', async () => {
    const notAfter = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
    mockSend
      .mockResolvedValueOnce({ CertificateSummaryList: [{ CertificateArn: arn, DomainName: 'example.com' }] })
      .mockResolvedValueOnce({ Certificate: { Status: 'ISSUED', NotAfter: notAfter, DomainName: 'example.com' } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a non-ISSUED certificate', async () => {
    mockSend
      .mockResolvedValueOnce({ CertificateSummaryList: [{ CertificateArn: arn, DomainName: 'example.com' }] })
      .mockResolvedValueOnce({ Certificate: { Status: 'PENDING_VALIDATION', DomainName: 'example.com' } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a certificate after a per-certificate error instead of failing the whole scan', async () => {
    mockSend.mockResolvedValueOnce({ CertificateSummaryList: [{ CertificateArn: arn }] }).mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListCertificatesCommand and DescribeCertificateCommand', async () => {
    mockSend.mockResolvedValueOnce({ CertificateSummaryList: [{ CertificateArn: arn }] }).mockResolvedValueOnce({ Certificate: { Status: 'PENDING_VALIDATION' } });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListCertificatesCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeCertificateCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListCertificates itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
