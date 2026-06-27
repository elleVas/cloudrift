// SPDX-License-Identifier: Apache-2.0
import { RedshiftClient } from '@aws-sdk/client-redshift';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsRedshiftIdleScanner } from './aws-redshift-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-redshift');
jest.mock('@aws-sdk/client-cloudwatch');

const mockRedshiftSend = jest.fn();
const mockRedshiftDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (RedshiftClient as jest.Mock).mockImplementation(() => ({ send: mockRedshiftSend, destroy: mockRedshiftDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getRedshiftNodePricePerMonth: jest.fn().mockResolvedValue(180.5) };
const scanner = new AwsRedshiftIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

describe('AwsRedshiftIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('redshift-idle-cluster');
  });

  it('reports an old cluster with zero connections', async () => {
    mockRedshiftSend.mockResolvedValueOnce({
      Clusters: [{ ClusterIdentifier: 'cluster-1', NodeType: 'dc2.large', NumberOfNodes: 2, ClusterCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(['cluster-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(180.5 * 2, 2);
  });

  it('does not report a cluster with active connections', async () => {
    mockRedshiftSend.mockResolvedValueOnce({
      Clusters: [{ ClusterIdentifier: 'busy', NodeType: 'dc2.large', NumberOfNodes: 1, ClusterCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 3 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created cluster (grace period)', async () => {
    mockRedshiftSend.mockResolvedValueOnce({
      Clusters: [{ ClusterIdentifier: 'new', NodeType: 'dc2.large', NumberOfNodes: 1, ClusterCreateTime: new Date() }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no clusters exist', async () => {
    mockRedshiftSend.mockResolvedValueOnce({ Clusters: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries the DatabaseConnections metric from the AWS/Redshift namespace', async () => {
    mockRedshiftSend.mockResolvedValueOnce({
      Clusters: [{ ClusterIdentifier: 'cluster-1', NodeType: 'dc2.large', NumberOfNodes: 1, ClusterCreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/Redshift');
    expect(args.MetricName).toBe('DatabaseConnections');
    expect(args.Dimensions).toEqual([{ Name: 'ClusterIdentifier', Value: 'cluster-1' }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockRedshiftSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('Redshift');
    expect(mockRedshiftDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
