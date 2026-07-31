// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { AwsS3BucketVersioningDisabledScanner } from './aws-s3-bucket-versioning-disabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-s3');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsS3BucketVersioningDisabledScanner();

describe('AwsS3BucketVersioningDisabledScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('s3-bucket-versioning-disabled');
    expect(scanner.scope).toBe('global');
  });

  it('flags a bucket with versioning disabled', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] }).mockResolvedValueOnce({ Status: undefined });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect((result.value[0] as { issue: string }).issue).toBe('versioning-disabled');
    }
  });

  it('flags a bucket with versioning enabled but MFA delete disabled', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] }).mockResolvedValueOnce({ Status: 'Enabled', MFADelete: 'Disabled' });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect((result.value[0] as { issue: string }).issue).toBe('mfa-delete-disabled');
    }
  });

  it('does not flag a bucket with versioning and MFA delete both enabled', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] }).mockResolvedValueOnce({ Status: 'Enabled', MFADelete: 'Enabled' });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a bucket after a per-bucket error instead of failing the whole scan', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] }).mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListBucketsCommand and GetBucketVersioningCommand', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] }).mockResolvedValueOnce({ Status: 'Enabled', MFADelete: 'Enabled' });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListBucketsCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetBucketVersioningCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListBuckets itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
