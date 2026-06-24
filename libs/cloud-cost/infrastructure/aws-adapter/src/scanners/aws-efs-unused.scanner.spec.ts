// SPDX-License-Identifier: Apache-2.0
import { EFSClient } from '@aws-sdk/client-efs';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsEfsUnusedScanner } from './aws-efs-unused.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-efs');
jest.mock('@aws-sdk/client-cloudwatch');

const mockEfsSend = jest.fn();
const mockEfsDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EFSClient as jest.Mock).mockImplementation(() => ({
    send: mockEfsSend,
    destroy: mockEfsDestroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEfsUnusedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsEfsUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('efs-unused');
  });

  it('reports an old file system with no mount targets, skipping CloudWatch', async () => {
    mockEfsSend.mockResolvedValueOnce({
      FileSystems: [
        {
          FileSystemId: 'fs-orphan',
          NumberOfMountTargets: 0,
          SizeInBytes: { Value: 1024 ** 3 },
          CreationTime: OLD_DATE,
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((fs) => fs.id)).toEqual(['fs-orphan']);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('reports an old file system mounted but with zero I/O', async () => {
    mockEfsSend.mockResolvedValueOnce({
      FileSystems: [
        {
          FileSystemId: 'fs-idle',
          NumberOfMountTargets: 1,
          SizeInBytes: { Value: 1024 ** 3 },
          CreationTime: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((fs) => fs.id)).toEqual(['fs-idle']);
  });

  it('does not report a mounted file system with I/O activity', async () => {
    mockEfsSend.mockResolvedValueOnce({
      FileSystems: [
        {
          FileSystemId: 'fs-active',
          NumberOfMountTargets: 1,
          SizeInBytes: { Value: 1024 ** 3 },
          CreationTime: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 4096 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created file system (grace period)', async () => {
    mockEfsSend.mockResolvedValueOnce({
      FileSystems: [
        {
          FileSystemId: 'fs-new',
          NumberOfMountTargets: 0,
          SizeInBytes: { Value: 1024 ** 3 },
          CreationTime: new Date(),
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('queries DataReadIOBytes and DataWriteIOBytes for mounted file systems', async () => {
    mockEfsSend.mockResolvedValueOnce({
      FileSystems: [
        {
          FileSystemId: 'fs-1',
          NumberOfMountTargets: 1,
          SizeInBytes: { Value: 1024 ** 3 },
          CreationTime: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [] });

    await scanner.scan(region);

    const metricNames = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls.map(
      (call) => call[0].MetricName,
    );
    expect(metricNames).toEqual(expect.arrayContaining(['DataReadIOBytes', 'DataWriteIOBytes']));
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEfsSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EFS');
    expect(mockEfsDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
