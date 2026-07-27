// SPDX-License-Identifier: Apache-2.0
import { DocumentDbInstance } from './documentdb-instance.entity';
import type { DocumentDbInstanceProps } from './documentdb-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeInstance(overrides: Partial<DocumentDbInstanceProps> = {}): DocumentDbInstance {
  return new DocumentDbInstance({
    dbInstanceIdentifier: 'my-docdb-instance',
    region,
    accountId: '123456789012',
    dbInstanceClass: 'db.r5.large',
    connectionsLastWindow: 0,
    metricWindowHours: 48,
    instanceCreateTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 205.3,
    ...overrides,
  });
}

describe('DocumentDbInstance', () => {
  it('exposes correct id and fields', () => {
    const instance = makeInstance();
    expect(instance.id).toBe('my-docdb-instance');
    expect(instance.dbInstanceClass).toBe('db.r5.large');
  });

  it('exposes kind', () => {
    expect(makeInstance().kind).toBe('documentdb-idle-instance');
  });

  it('wasteReason references the metric window', () => {
    expect(makeInstance({ metricWindowHours: 48 }).wasteReason).toBe('zero connections in last 48h');
  });

  it('isIdle returns true when no connections were observed', () => {
    expect(makeInstance({ connectionsLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when connections were observed', () => {
    expect(makeInstance({ connectionsLastWindow: 3 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeInstance().costEstimate.monthlyCostUsd).toBe(205.3);
  });

  it('costEstimate description references the instance class', () => {
    expect(makeInstance({ dbInstanceClass: 'db.r6g.xlarge' }).costEstimate.description).toContain('db.r6g.xlarge');
  });

  it('exposes the remaining props', () => {
    const instanceCreateTime = new Date('2024-01-01');
    const detectedAt = new Date('2026-06-09');
    const instance = makeInstance({
      region,
      accountId: '999999999999',
      instanceCreateTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(instance.region).toBe(region);
    expect(instance.accountId).toBe('999999999999');
    expect(instance.instanceCreateTime).toBe(instanceCreateTime);
    expect(instance.detectedAt).toBe(detectedAt);
    expect(instance.tags).toEqual({ env: 'prod' });
  });
});
