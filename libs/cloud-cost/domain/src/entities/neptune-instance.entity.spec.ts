// SPDX-License-Identifier: Apache-2.0
import { NeptuneInstance } from './neptune-instance.entity';
import type { NeptuneInstanceProps } from './neptune-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeInstance(overrides: Partial<NeptuneInstanceProps> = {}): NeptuneInstance {
  return new NeptuneInstance({
    dbInstanceIdentifier: 'my-neptune-instance',
    region,
    accountId: '123456789012',
    dbInstanceClass: 'db.r5.large',
    requestsLastWindow: 0,
    metricWindowHours: 336,
    instanceCreateTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 260,
    ...overrides,
  });
}

describe('NeptuneInstance', () => {
  it('exposes correct id and fields', () => {
    const instance = makeInstance();
    expect(instance.id).toBe('my-neptune-instance');
    expect(instance.dbInstanceClass).toBe('db.r5.large');
  });

  it('exposes kind', () => {
    expect(makeInstance().kind).toBe('neptune-idle-instance');
  });

  it('wasteReason references the metric window', () => {
    expect(makeInstance({ metricWindowHours: 336 }).wasteReason).toBe('zero query traffic in last 336h');
  });

  it('isIdle returns true when there is zero query traffic', () => {
    expect(makeInstance({ requestsLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when there is query traffic', () => {
    expect(makeInstance({ requestsLastWindow: 42 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the monthly cost and instance class description', () => {
    const instance = makeInstance({ dbInstanceClass: 'db.r5.xlarge', monthlyCostUsd: 520 });
    expect(instance.costEstimate.monthlyCostUsd).toBe(520);
    expect(instance.costEstimate.description).toBe('Idle db.r5.xlarge Neptune instance');
  });

  it('exposes the remaining props', () => {
    const instanceCreateTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const instance = makeInstance({
      dbInstanceClass: 'db.r5.xlarge',
      requestsLastWindow: 7,
      metricWindowHours: 168,
      instanceCreateTime,
      region,
      accountId: '999999999999',
      tags: { env: 'prod' },
      detectedAt,
    });
    expect(instance.requestsLastWindow).toBe(7);
    expect(instance.metricWindowHours).toBe(168);
    expect(instance.instanceCreateTime).toBe(instanceCreateTime);
    expect(instance.region).toBe(region);
    expect(instance.accountId).toBe('999999999999');
    expect(instance.tags).toEqual({ env: 'prod' });
    expect(instance.detectedAt).toBe(detectedAt);
  });
});
