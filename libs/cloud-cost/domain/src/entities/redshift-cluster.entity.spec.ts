// SPDX-License-Identifier: Apache-2.0
import { RedshiftCluster } from './redshift-cluster.entity';
import type { RedshiftClusterProps } from './redshift-cluster.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeCluster(overrides: Partial<RedshiftClusterProps> = {}): RedshiftCluster {
  return new RedshiftCluster({
    clusterIdentifier: 'my-cluster',
    region,
    accountId: '123456789012',
    nodeType: 'dc2.large',
    numberOfNodes: 2,
    connectionsLastWindow: 0,
    metricWindowHours: 336,
    clusterCreateTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 180,
    ...overrides,
  });
}

describe('RedshiftCluster', () => {
  it('exposes correct id and fields', () => {
    const cluster = makeCluster();
    expect(cluster.id).toBe('my-cluster');
    expect(cluster.nodeType).toBe('dc2.large');
  });

  it('exposes kind', () => {
    expect(makeCluster().kind).toBe('redshift-idle-cluster');
  });

  it('wasteReason references the metric window', () => {
    expect(makeCluster({ metricWindowHours: 336 }).wasteReason).toBe('zero connections in last 336h');
  });

  it('isIdle returns true when there are zero connections in the window', () => {
    expect(makeCluster({ connectionsLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when there are connections in the window', () => {
    expect(makeCluster({ connectionsLastWindow: 5 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeCluster({ monthlyCostUsd: 180 }).costEstimate.monthlyCostUsd).toBe(180);
  });

  it('exposes the remaining props', () => {
    const clusterCreateTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const cluster = makeCluster({
      region,
      accountId: '999999999999',
      numberOfNodes: 4,
      connectionsLastWindow: 12,
      metricWindowHours: 72,
      clusterCreateTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(cluster.region).toBe(region);
    expect(cluster.accountId).toBe('999999999999');
    expect(cluster.numberOfNodes).toBe(4);
    expect(cluster.connectionsLastWindow).toBe(12);
    expect(cluster.metricWindowHours).toBe(72);
    expect(cluster.clusterCreateTime).toBe(clusterCreateTime);
    expect(cluster.detectedAt).toBe(detectedAt);
    expect(cluster.tags).toEqual({ env: 'prod' });
  });
});
