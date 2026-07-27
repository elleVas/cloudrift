// SPDX-License-Identifier: Apache-2.0
import { MskCluster } from './msk-cluster.entity';
import type { MskClusterProps } from './msk-cluster.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeCluster(overrides: Partial<MskClusterProps> = {}): MskCluster {
  return new MskCluster({
    clusterName: 'my-cluster',
    region,
    accountId: '123456789012',
    brokerInstanceType: 'kafka.t3.small',
    numberOfBrokerNodes: 3,
    bytesLastWindow: 0,
    metricWindowHours: 336,
    creationTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 105,
    ...overrides,
  });
}

describe('MskCluster', () => {
  it('exposes correct id and fields', () => {
    const cluster = makeCluster();
    expect(cluster.id).toBe('my-cluster');
    expect(cluster.brokerInstanceType).toBe('kafka.t3.small');
  });

  it('exposes kind', () => {
    expect(makeCluster().kind).toBe('msk-idle-cluster');
  });

  it('wasteReason references the metric window', () => {
    expect(makeCluster({ metricWindowHours: 336 }).wasteReason).toBe('zero broker traffic in last 336h');
  });

  it('isIdle returns true when there is zero broker traffic', () => {
    expect(makeCluster({ bytesLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when there is broker traffic', () => {
    expect(makeCluster({ bytesLastWindow: 2048 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the monthly cost and instance type description', () => {
    const cluster = makeCluster({ brokerInstanceType: 'kafka.m5.large', monthlyCostUsd: 420 });
    expect(cluster.costEstimate.monthlyCostUsd).toBe(420);
    expect(cluster.costEstimate.description).toBe('Idle kafka.m5.large MSK cluster');
  });

  it('exposes the remaining props', () => {
    const creationTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const cluster = makeCluster({
      brokerInstanceType: 'kafka.m5.large',
      numberOfBrokerNodes: 6,
      bytesLastWindow: 8192,
      metricWindowHours: 168,
      creationTime,
      region,
      accountId: '999999999999',
      tags: { env: 'prod' },
      detectedAt,
    });
    expect(cluster.numberOfBrokerNodes).toBe(6);
    expect(cluster.bytesLastWindow).toBe(8192);
    expect(cluster.metricWindowHours).toBe(168);
    expect(cluster.creationTime).toBe(creationTime);
    expect(cluster.region).toBe(region);
    expect(cluster.accountId).toBe('999999999999');
    expect(cluster.tags).toEqual({ env: 'prod' });
    expect(cluster.detectedAt).toBe(detectedAt);
  });
});
