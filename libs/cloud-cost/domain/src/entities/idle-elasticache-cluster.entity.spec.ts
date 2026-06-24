// SPDX-License-Identifier: Apache-2.0
import { IdleElastiCacheCluster } from './idle-elasticache-cluster.entity';
import type { IdleElastiCacheClusterProps } from './idle-elasticache-cluster.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeCluster(overrides: Partial<IdleElastiCacheClusterProps> = {}): IdleElastiCacheCluster {
  return new IdleElastiCacheCluster({
    cacheClusterId: 'my-cluster',
    region,
    accountId: '123456789012',
    cacheNodeType: 'cache.t3.micro',
    numCacheNodes: 1,
    connectionsLastWindow: 0,
    metricWindowHours: 48,
    createTime: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 12.41,
    ...overrides,
  });
}

describe('IdleElastiCacheCluster', () => {
  it('exposes correct id and fields', () => {
    const cluster = makeCluster();
    expect(cluster.id).toBe('my-cluster');
    expect(cluster.cacheNodeType).toBe('cache.t3.micro');
    expect(cluster.tags).toEqual({ Env: 'dev' });
  });

  it('isIdle returns true when no connections were observed', () => {
    expect(makeCluster({ connectionsLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when connections were observed', () => {
    expect(makeCluster({ connectionsLastWindow: 5 }).isIdle()).toBe(false);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeCluster().kind).toBe('elasticache-idle');
    expect(makeCluster().wasteReason).toContain('48h');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeCluster().costEstimate.monthlyCostUsd).toBe(12.41);
  });

  it('costEstimate description references the node type', () => {
    expect(makeCluster().costEstimate.description).toContain('cache.t3.micro');
  });
});
