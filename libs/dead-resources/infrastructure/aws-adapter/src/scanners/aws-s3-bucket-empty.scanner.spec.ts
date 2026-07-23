// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { AwsS3BucketEmptyScanner } from './aws-s3-bucket-empty.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-s3');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (S3Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsS3BucketEmptyScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

/** ListBuckets -> (per bucket) ListObjectsV2, in that call order. */
function queueBucket(bucket: unknown, keyCount: number): void {
  mockSend.mockResolvedValueOnce({ Buckets: [bucket] }).mockResolvedValueOnce({ KeyCount: keyCount });
}

describe('AwsS3BucketEmptyScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('s3-bucket-empty');
    expect(scanner.scope).toBe('global');
  });

  it('flags an old bucket with zero objects', async () => {
    queueBucket({ Name: 'old-bucket', CreationDate: oldDate }, 0);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((b) => b.id)).toEqual(['old-bucket']);
  });

  it('does not flag a bucket with objects', async () => {
    queueBucket({ Name: 'used-bucket', CreationDate: oldDate }, 3);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a bucket created within the grace period', async () => {
    queueBucket({ Name: 'new-bucket', CreationDate: new Date() }, 0);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a bucket it cannot inspect instead of failing the whole scan', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [{ Name: 'forbidden-bucket', CreationDate: oldDate }] }).mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListBucketsCommand', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListBucketsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListBuckets itself fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
