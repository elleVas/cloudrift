// SPDX-License-Identifier: Apache-2.0
import { ACMClient, ListCertificatesCommand } from '@aws-sdk/client-acm';
import { AwsAcmCertificateUnusedScanner } from './aws-acm-certificate-unused.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-acm');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ACMClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsAcmCertificateUnusedScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

describe('AwsAcmCertificateUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('acm-certificate-unused');
  });

  it('flags an old certificate not in use', async () => {
    mockSend.mockResolvedValueOnce({
      CertificateSummaryList: [
        { CertificateArn: 'arn:aws:acm:us-east-1:123:certificate/1', DomainName: 'old.example.com', CreatedAt: oldDate, InUse: false },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(['arn:aws:acm:us-east-1:123:certificate/1']);
  });

  it('does not flag a certificate in use', async () => {
    mockSend.mockResolvedValueOnce({
      CertificateSummaryList: [
        { CertificateArn: 'arn:aws:acm:us-east-1:123:certificate/2', DomainName: 'active.example.com', CreatedAt: oldDate, InUse: true },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a certificate created within the grace period', async () => {
    mockSend.mockResolvedValueOnce({
      CertificateSummaryList: [
        { CertificateArn: 'arn:aws:acm:us-east-1:123:certificate/3', DomainName: 'new.example.com', CreatedAt: new Date(), InUse: false },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListCertificatesCommand', async () => {
    mockSend.mockResolvedValueOnce({ CertificateSummaryList: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListCertificatesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
