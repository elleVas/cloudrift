// SPDX-License-Identifier: Apache-2.0
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { AwsRdsUnderutilizedScanner } from './aws-rds-underutilized.scanner';
import type { RdsInstancePricingSource } from './aws-rds-underutilized.scanner';
import { AwsRegion, type RdsUnderutilizedInstance } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-rds');
jest.mock('@aws-sdk/client-cloudwatch');

const mockRdsSend = jest.fn();
const mockRdsDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();
const mockGetRdsInstancePrice = jest.fn();

const mockPricing: RdsInstancePricingSource = {
  getRdsInstancePricePerMonth: mockGetRdsInstancePrice,
};

beforeEach(() => {
  jest.clearAllMocks();
  (RDSClient as jest.Mock).mockImplementation(() => ({
    send: mockRdsSend,
    destroy: mockRdsDestroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
  mockGetRdsInstancePrice.mockResolvedValue(140); // $/mo
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsRdsUnderutilizedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function availableInstance(
  overrides: Partial<{
    DBInstanceIdentifier: string;
    DBInstanceClass: string;
    Engine: string;
    MultiAZ: boolean;
    InstanceCreateTime: Date;
  }> = {},
) {
  return {
    DBInstanceIdentifier: overrides.DBInstanceIdentifier ?? 'db-1',
    DBInstanceClass: overrides.DBInstanceClass ?? 'db.t3.medium',
    Engine: overrides.Engine ?? 'postgres',
    DBInstanceStatus: 'available',
    MultiAZ: overrides.MultiAZ ?? false,
    InstanceCreateTime: overrides.InstanceCreateTime ?? OLD_DATE,
    TagList: [],
  };
}

describe('AwsRdsUnderutilizedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('rds-underutilized');
  });

  it('reports an old available instance with low max CPU and costs it at half the instance price', async () => {
    mockRdsSend.mockResolvedValueOnce({ DBInstances: [availableInstance()] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1.2, Maximum: 2.5 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((i) => i.id)).toEqual(['db-1']);
    const inst = result.value[0] as RdsUnderutilizedInstance;
    expect(inst.kind).toBe('rds-underutilized');
    expect(inst.avgCpuPercent).toBe(1.2);
    expect(inst.maxCpuPercent).toBe(2.5);
    expect(inst.costEstimate.monthlyCostUsd).toBeCloseTo(70, 2); // 140 * 0.5
  });

  it('does not report an instance with CPU above the threshold', async () => {
    mockRdsSend.mockResolvedValueOnce({ DBInstances: [availableInstance()] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 30, Maximum: 80 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created instance (grace period)', async () => {
    mockRdsSend.mockResolvedValueOnce({
      DBInstances: [availableInstance({ InstanceCreateTime: new Date() })],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch and pricing entirely when no available instances exist', async () => {
    mockRdsSend.mockResolvedValueOnce({ DBInstances: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
    expect(mockGetRdsInstancePrice).not.toHaveBeenCalled();
  });

  it('sends DescribeDBInstancesCommand with no status filter (db-instance-status is not a valid RDS filter name)', async () => {
    mockRdsSend.mockResolvedValueOnce({ DBInstances: [] });

    await scanner.scan(region);

    const args = (DescribeDBInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toBeUndefined();
  });

  it('excludes non-available instances in-memory, since AWS returns every status unfiltered', async () => {
    mockRdsSend.mockResolvedValueOnce({
      DBInstances: [
        availableInstance({ DBInstanceIdentifier: 'db-available' }),
        { ...availableInstance({ DBInstanceIdentifier: 'db-stopped' }), DBInstanceStatus: 'stopped' },
      ],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((i) => i.id)).toEqual(['db-available']);
    expect(mockCwSend).toHaveBeenCalledTimes(1);
  });

  it('queries AWS/RDS CPUUtilization with Average and Maximum statistics', async () => {
    mockRdsSend.mockResolvedValueOnce({ DBInstances: [availableInstance()] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/RDS');
    expect(args.MetricName).toBe('CPUUtilization');
    expect(args.Period).toBe(168 * 3600);
    expect(args.Statistics).toEqual(['Average', 'Maximum']);
    expect(args.Dimensions).toEqual([{ Name: 'DBInstanceIdentifier', Value: 'db-1' }]);
  });

  it('fetches the instance price only once per distinct class/engine/multiAZ combination', async () => {
    mockRdsSend.mockResolvedValueOnce({
      DBInstances: [
        availableInstance({ DBInstanceIdentifier: 'db-1' }),
        availableInstance({ DBInstanceIdentifier: 'db-2' }),
      ],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    await scanner.scan(region);

    expect(mockGetRdsInstancePrice).toHaveBeenCalledTimes(1);
    expect(mockGetRdsInstancePrice).toHaveBeenCalledWith(region, 'db.t3.medium', 'postgres', false);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockRdsSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('RDS');
    expect(mockRdsDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
