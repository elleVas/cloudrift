// SPDX-License-Identifier: Apache-2.0
import { AuroraServerlessOverprovisioned } from './aurora-serverless-overprovisioned.entity';
import type { AuroraServerlessOverprovisionedProps } from './aurora-serverless-overprovisioned.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeCluster(overrides: Partial<AuroraServerlessOverprovisionedProps> = {}): AuroraServerlessOverprovisioned {
  return new AuroraServerlessOverprovisioned({
    clusterIdentifier: 'my-aurora-cluster',
    region,
    accountId: '123456789012',
    engine: 'aurora-postgresql',
    minAcu: 4,
    maxAcu: 16,
    peakAcu: 1.2,
    hasDatapoint: true,
    suggestedMinAcu: 1.5,
    windowHours: 336,
    clusterCreateTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 182.5,
    ...overrides,
  });
}

describe('AuroraServerlessOverprovisioned', () => {
  it('exposes correct id and fields', () => {
    const cluster = makeCluster();
    expect(cluster.id).toBe('my-aurora-cluster');
    expect(cluster.engine).toBe('aurora-postgresql');
  });

  it('exposes kind', () => {
    expect(makeCluster().kind).toBe('aurora-serverless-overprovisioned');
  });

  it('wasteReason references peak ACU, Min ACU, window and suggestion', () => {
    const reason = makeCluster({ peakAcu: 1.2, minAcu: 4, windowHours: 336, suggestedMinAcu: 1.5 }).wasteReason;
    expect(reason).toContain('peak 1.20 ACU');
    expect(reason).toContain('Min ACU 4');
    expect(reason).toContain('336h');
    expect(reason).toContain('lower Min ACU to 1.5');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeCluster().costEstimate.monthlyCostUsd).toBe(182.5);
  });

  it('costEstimate description references the engine and Min ACU transition', () => {
    const description = makeCluster({ engine: 'aurora-mysql', minAcu: 4, suggestedMinAcu: 1.5 }).costEstimate
      .description;
    expect(description).toContain('aurora-mysql');
    expect(description).toContain('4→1.5');
  });

  it('exposes the remaining props', () => {
    const clusterCreateTime = new Date('2024-01-01');
    const detectedAt = new Date('2026-06-09');
    const cluster = makeCluster({
      region,
      accountId: '999999999999',
      maxAcu: 32,
      hasDatapoint: false,
      clusterCreateTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(cluster.region).toBe(region);
    expect(cluster.accountId).toBe('999999999999');
    expect(cluster.maxAcu).toBe(32);
    expect(cluster.hasDatapoint).toBe(false);
    expect(cluster.clusterCreateTime).toBe(clusterCreateTime);
    expect(cluster.detectedAt).toBe(detectedAt);
    expect(cluster.tags).toEqual({ env: 'prod' });
  });
});
