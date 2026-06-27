// SPDX-License-Identifier: Apache-2.0
import { FSxClient } from '@aws-sdk/client-fsx';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsFsxIdleScanner } from './aws-fsx-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-fsx');
jest.mock('@aws-sdk/client-cloudwatch');

const mockFsxSend = jest.fn();
const mockFsxDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (FSxClient as jest.Mock).mockImplementation(() => ({ send: mockFsxSend, destroy: mockFsxDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsFsxIdleScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsFsxIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('fsx-idle-filesystem');
  });

  it('reports an old file system with zero I/O', async () => {
    mockFsxSend.mockResolvedValueOnce({
      FileSystems: [
        { FileSystemId: 'fs-1', FileSystemType: 'WINDOWS', StorageCapacity: 100, CreationTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((fs) => fs.id)).toEqual(['fs-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(0.13 * 100, 2);
  });

  it('does not report a file system with I/O activity', async () => {
    mockFsxSend.mockResolvedValueOnce({
      FileSystems: [
        { FileSystemId: 'fs-busy', FileSystemType: 'WINDOWS', StorageCapacity: 100, CreationTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 500 }] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created file system (grace period)', async () => {
    mockFsxSend.mockResolvedValueOnce({
      FileSystems: [{ FileSystemId: 'fs-new', FileSystemType: 'WINDOWS', StorageCapacity: 100, CreationTime: new Date() }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no file systems exist', async () => {
    mockFsxSend.mockResolvedValueOnce({ FileSystems: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries DataReadBytes/DataWriteBytes from the AWS/FSx namespace', async () => {
    mockFsxSend.mockResolvedValueOnce({
      FileSystems: [{ FileSystemId: 'fs-1', FileSystemType: 'WINDOWS', StorageCapacity: 100, CreationTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const calls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls;
    expect(calls[0][0].Namespace).toBe('AWS/FSx');
    expect(calls[0][0].MetricName).toBe('DataReadBytes');
    expect(calls[0][0].Dimensions).toEqual([{ Name: 'FileSystemId', Value: 'fs-1' }]);
    expect(calls[1][0].MetricName).toBe('DataWriteBytes');
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockFsxSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('FSx');
    expect(mockFsxDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
