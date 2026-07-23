// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand, GetBucketEncryptionCommand } from '@aws-sdk/client-s3';
import { AwsS3BucketEncryptionMissingScanner } from './aws-s3-bucket-encryption-missing.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-s3');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsS3BucketEncryptionMissingScanner();

describe('AwsS3BucketEncryptionMissingScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('s3-bucket-encryption-missing');
    expect(scanner.scope).toBe('global');
  });

  it('flags a bucket with no default encryption configured', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListBucketsCommand) return Promise.resolve({ Buckets: [{ Name: 'my-bucket' }] });
      if (command instanceof GetBucketEncryptionCommand) {
        return Promise.reject(Object.assign(new Error('not configured'), { name: 'ServerSideEncryptionConfigurationNotFoundError' }));
      }
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['my-bucket']);
  });

  it('does not flag a bucket with default encryption configured', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListBucketsCommand) return Promise.resolve({ Buckets: [{ Name: 'my-bucket' }] });
      if (command instanceof GetBucketEncryptionCommand) {
        return Promise.resolve({ ServerSideEncryptionConfiguration: { Rules: [{}] } });
      }
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a bucket that errors unexpectedly without failing the whole scan', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListBucketsCommand) return Promise.resolve({ Buckets: [{ Name: 'my-bucket' }] });
      if (command instanceof GetBucketEncryptionCommand) return Promise.reject(new Error('AccessDenied'));
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError when ListBuckets itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
