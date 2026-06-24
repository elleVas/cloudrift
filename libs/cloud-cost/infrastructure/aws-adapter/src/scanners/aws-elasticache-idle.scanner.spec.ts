// SPDX-License-Identifier: Apache-2.0
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsElastiCacheIdleScanner } from './aws-elasticache-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-elasticache');
jest.mock('@aws-sdk/client-cloudwatch');

const mockEcSend = jest.fn();
const mockEcDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ElastiCacheClient as jest.Mock).mockImplementation(() => ({
    send: mockEcSend,
    destroy: mockEcDestroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getElastiCacheNodePricePerMonth: jest.fn().mockResolvedValue(12.41) };
const scanner = new AwsElastiCacheIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

describe('AwsElastiCacheIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('elasticache-idle');
  });

  it('reports an old cluster with zero connections', async () => {
    mockEcSend.mockResolvedValueOnce({
      CacheClusters: [
        { CacheClusterId: 'my-cluster', CacheNodeType: 'cache.t3.micro', NumCacheNodes: 1, CacheClusterCreateTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(['my-cluster']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(12.41, 2);
  });

  it('does not report a cluster with active connections', async () => {
    mockEcSend.mockResolvedValueOnce({
      CacheClusters: [
        { CacheClusterId: 'busy-cluster', CacheNodeType: 'cache.t3.micro', NumCacheNodes: 1, CacheClusterCreateTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 42 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created cluster (grace period)', async () => {
    mockEcSend.mockResolvedValueOnce({
      CacheClusters: [
        { CacheClusterId: 'new-cluster', CacheNodeType: 'cache.t3.micro', NumCacheNodes: 1, CacheClusterCreateTime: new Date() },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no clusters exist', async () => {
    mockEcSend.mockResolvedValueOnce({ CacheClusters: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries the CurrConnections metric per cluster', async () => {
    mockEcSend.mockResolvedValueOnce({
      CacheClusters: [
        { CacheClusterId: 'my-cluster', CacheNodeType: 'cache.t3.micro', NumCacheNodes: 1, CacheClusterCreateTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const cwArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cwArgs.Namespace).toBe('AWS/ElastiCache');
    expect(cwArgs.MetricName).toBe('CurrConnections');
    expect(cwArgs.Dimensions).toEqual([{ Name: 'CacheClusterId', Value: 'my-cluster' }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEcSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('ElastiCache');
    expect(mockEcDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
