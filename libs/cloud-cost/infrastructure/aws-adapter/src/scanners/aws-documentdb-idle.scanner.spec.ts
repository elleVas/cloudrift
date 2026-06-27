// SPDX-License-Identifier: Apache-2.0
import { DocDBClient, DescribeDBInstancesCommand } from '@aws-sdk/client-docdb';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsDocumentDbIdleScanner } from './aws-documentdb-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-docdb');
jest.mock('@aws-sdk/client-cloudwatch');

const mockDocDbSend = jest.fn();
const mockDocDbDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (DocDBClient as jest.Mock).mockImplementation(() => ({ send: mockDocDbSend, destroy: mockDocDbDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getDocDbInstancePricePerMonth: jest.fn().mockResolvedValue(95.5) };
const scanner = new AwsDocumentDbIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

describe('AwsDocumentDbIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('documentdb-idle-instance');
  });

  it('reports an old instance with zero connections', async () => {
    mockDocDbSend.mockResolvedValueOnce({
      DBInstances: [{ DBInstanceIdentifier: 'docdb-1', DBInstanceClass: 'db.r5.large', InstanceCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((i) => i.id)).toEqual(['docdb-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(95.5, 2);
  });

  it('does not report an instance with active connections', async () => {
    mockDocDbSend.mockResolvedValueOnce({
      DBInstances: [{ DBInstanceIdentifier: 'busy', DBInstanceClass: 'db.r5.large', InstanceCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 4 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters DescribeDBInstances on engine=docdb', async () => {
    mockDocDbSend.mockResolvedValueOnce({ DBInstances: [] });

    await scanner.scan(region);

    const args = (DescribeDBInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'engine', Values: ['docdb'] }]);
  });

  it('queries the DatabaseConnections metric from the AWS/DocDB namespace', async () => {
    mockDocDbSend.mockResolvedValueOnce({
      DBInstances: [{ DBInstanceIdentifier: 'docdb-1', DBInstanceClass: 'db.r5.large', InstanceCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/DocDB');
    expect(args.MetricName).toBe('DatabaseConnections');
    expect(args.Dimensions).toEqual([{ Name: 'DBInstanceIdentifier', Value: 'docdb-1' }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockDocDbSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('DocumentDB');
    expect(mockDocDbDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
