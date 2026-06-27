// SPDX-License-Identifier: Apache-2.0
import { NeptuneClient, DescribeDBInstancesCommand } from '@aws-sdk/client-neptune';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsNeptuneIdleScanner } from './aws-neptune-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-neptune');
jest.mock('@aws-sdk/client-cloudwatch');

const mockNeptuneSend = jest.fn();
const mockNeptuneDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (NeptuneClient as jest.Mock).mockImplementation(() => ({ send: mockNeptuneSend, destroy: mockNeptuneDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getNeptuneInstancePricePerMonth: jest.fn().mockResolvedValue(210) };
const scanner = new AwsNeptuneIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

describe('AwsNeptuneIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('neptune-idle-instance');
  });

  it('reports an old instance with zero query traffic', async () => {
    mockNeptuneSend.mockResolvedValueOnce({
      DBInstances: [{ DBInstanceIdentifier: 'neptune-1', DBInstanceClass: 'db.r5.large', InstanceCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((i) => i.id)).toEqual(['neptune-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(210, 2);
  });

  it('does not report an instance with query traffic', async () => {
    mockNeptuneSend.mockResolvedValueOnce({
      DBInstances: [{ DBInstanceIdentifier: 'busy', DBInstanceClass: 'db.r5.large', InstanceCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 12 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters DescribeDBInstances on engine=neptune', async () => {
    mockNeptuneSend.mockResolvedValueOnce({ DBInstances: [] });

    await scanner.scan(region);

    const args = (DescribeDBInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'engine', Values: ['neptune'] }]);
  });

  it('queries the TotalRequestsPerSec metric from the AWS/Neptune namespace', async () => {
    mockNeptuneSend.mockResolvedValueOnce({
      DBInstances: [{ DBInstanceIdentifier: 'neptune-1', DBInstanceClass: 'db.r5.large', InstanceCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/Neptune');
    expect(args.MetricName).toBe('TotalRequestsPerSec');
    expect(args.Dimensions).toEqual([{ Name: 'DBInstanceIdentifier', Value: 'neptune-1' }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockNeptuneSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('Neptune');
    expect(mockNeptuneDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
