// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsS3NoLifecycleScanner } from './aws-s3-no-lifecycle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-cloudwatch');

const mockS3Send = jest.fn();
const mockS3Destroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

function noSuchLifecycleError(): Error {
  const err = new Error('The lifecycle configuration does not exist');
  err.name = 'NoSuchLifecycleConfiguration';
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  (S3Client as jest.Mock).mockImplementation(() => ({
    send: mockS3Send,
    destroy: mockS3Destroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsS3NoLifecycleScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsS3NoLifecycleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('s3-no-lifecycle');
  });

  it('reports an old bucket with no lifecycle policy', async () => {
    mockS3Send
      .mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket', CreationDate: OLD_DATE }] })
      .mockRejectedValueOnce(noSuchLifecycleError());
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Average: 1024 ** 3 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((b) => b.id)).toEqual(['my-bucket']);
  });

  it('does not report a bucket with a lifecycle policy configured', async () => {
    mockS3Send
      .mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket', CreationDate: OLD_DATE }] })
      .mockResolvedValueOnce({ Rules: [{ ID: 'expire-old', Status: 'Enabled' }] });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Average: 1024 ** 3 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created bucket (grace period)', async () => {
    mockS3Send
      .mockResolvedValueOnce({ Buckets: [{ Name: 'new-bucket', CreationDate: new Date() }] })
      .mockRejectedValueOnce(noSuchLifecycleError());
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Average: 1024 ** 3 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters ListBuckets by BucketRegion', async () => {
    mockS3Send.mockResolvedValueOnce({ Buckets: [] });

    await scanner.scan(region);

    const args = (ListBucketsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.BucketRegion).toBe('us-east-1');
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries the BucketSizeBytes metric per bucket', async () => {
    mockS3Send
      .mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket', CreationDate: OLD_DATE }] })
      .mockRejectedValueOnce(noSuchLifecycleError());
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const cwArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cwArgs.Namespace).toBe('AWS/S3');
    expect(cwArgs.MetricName).toBe('BucketSizeBytes');
    expect(cwArgs.Dimensions).toEqual([
      { Name: 'BucketName', Value: 'my-bucket' },
      { Name: 'StorageType', Value: 'StandardStorage' },
    ]);
  });

  it('rethrows lifecycle errors that are not NoSuchLifecycleConfiguration', async () => {
    mockS3Send
      .mockResolvedValueOnce({ Buckets: [{ Name: 'my-bucket', CreationDate: OLD_DATE }] })
      .mockRejectedValueOnce(new Error('access denied'));
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('S3');
    expect(mockS3Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('S3');
    expect(mockS3Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
