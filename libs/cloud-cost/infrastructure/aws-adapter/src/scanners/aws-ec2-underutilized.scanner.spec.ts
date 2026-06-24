// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { AwsEc2UnderutilizedScanner } from './aws-ec2-underutilized.scanner';
import type { Ec2InstancePricingSource } from './aws-ec2-underutilized.scanner';
import { AwsRegion, type UnderutilizedEc2Instance } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-cloudwatch');

const mockEc2Send = jest.fn();
const mockEc2Destroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();
const mockGetEc2InstancePrice = jest.fn();

const mockPricing: Ec2InstancePricingSource = {
  getEc2InstancePricePerMonth: mockGetEc2InstancePrice,
};

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({
    send: mockEc2Send,
    destroy: mockEc2Destroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
  mockGetEc2InstancePrice.mockResolvedValue(70); // $/mo
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEc2UnderutilizedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function runningInstance(
  overrides: Partial<{ InstanceId: string; InstanceType: string; LaunchTime: Date }> = {},
) {
  return {
    InstanceId: overrides.InstanceId ?? 'i-1',
    InstanceType: overrides.InstanceType ?? 'm5.large',
    State: { Name: 'running' },
    LaunchTime: overrides.LaunchTime ?? OLD_DATE,
    Tags: [],
  };
}

describe('AwsEc2UnderutilizedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-underutilized');
  });

  it('reports an old running instance with low max CPU and costs it at half the instance price', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [runningInstance()] }] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1.2, Maximum: 2.5 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((i) => i.id)).toEqual(['i-1']);
    const inst = result.value[0] as UnderutilizedEc2Instance;
    expect(inst.kind).toBe('ec2-underutilized');
    expect(inst.avgCpuPercent).toBe(1.2);
    expect(inst.maxCpuPercent).toBe(2.5);
    expect(inst.costEstimate.monthlyCostUsd).toBeCloseTo(35, 2); // 70 * 0.5
  });

  it('does not report an instance with CPU above the threshold', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [runningInstance()] }] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 30, Maximum: 80 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly launched instance (grace period)', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [{ Instances: [runningInstance({ LaunchTime: new Date() })] }],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch and pricing entirely when no running instances exist', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
    expect(mockGetEc2InstancePrice).not.toHaveBeenCalled();
  });

  it('filters DescribeInstances on instance-state-name=running', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [] });

    await scanner.scan(region);

    const args = (DescribeInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'instance-state-name', Values: ['running'] }]);
  });

  it('queries CPUUtilization with Average and Maximum statistics', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [runningInstance()] }] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.MetricName).toBe('CPUUtilization');
    expect(args.Namespace).toBe('AWS/EC2');
    expect(args.Period).toBe(168 * 3600);
    expect(args.Statistics).toEqual(['Average', 'Maximum']);
    expect(args.Dimensions).toEqual([{ Name: 'InstanceId', Value: 'i-1' }]);
  });

  it('fetches the instance price only once per distinct instance type', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            runningInstance({ InstanceId: 'i-1', InstanceType: 'm5.large' }),
            runningInstance({ InstanceId: 'i-2', InstanceType: 'm5.large' }),
          ],
        },
      ],
    });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Average: 1, Maximum: 2 }] });

    await scanner.scan(region);

    expect(mockGetEc2InstancePrice).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEc2Send.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EC2');
    expect(mockEc2Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
