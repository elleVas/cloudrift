// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { AwsS3MultipartUploadAbandonedScanner } from './aws-s3-multipart-upload-abandoned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

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
const scanner = new AwsS3MultipartUploadAbandonedScanner(mockPricing);
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('AwsS3MultipartUploadAbandonedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('s3-multipart-upload-abandoned');
  });

  it('returns an old abandoned upload, summing part sizes', async () => {
    mockSend
      .mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] })
      .mockResolvedValueOnce({
        Uploads: [{ UploadId: 'upload-1', Key: 'big-file.zip', Initiated: oldDate }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 1, Size: 512 * 1024 ** 2 }, { PartNumber: 2, Size: 512 * 1024 ** 2 }],
        IsTruncated: false,
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((u) => u.id)).toEqual(['upload-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(0.023, 3);
  });

  it('does not flag an upload initiated less than the grace period ago', async () => {
    mockSend
      .mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket' }] })
      .mockResolvedValueOnce({
        Uploads: [{ UploadId: 'upload-2', Key: 'fresh.zip', Initiated: new Date() }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({ Parts: [], IsTruncated: false });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListBucketsCommand scoped to the region', async () => {
    mockSend.mockResolvedValueOnce({ Buckets: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListBucketsCommand));
    const constructorArgs = (ListBucketsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.BucketRegion).toBe('us-east-1');
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
