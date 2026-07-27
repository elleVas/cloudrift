// SPDX-License-Identifier: Apache-2.0
import { LambdaLogGroupOrphaned } from './lambda-loggroup-orphaned.entity';
import type { LambdaLogGroupOrphanedProps } from './lambda-loggroup-orphaned.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeLogGroup(overrides: Partial<LambdaLogGroupOrphanedProps> = {}): LambdaLogGroupOrphaned {
  return new LambdaLogGroupOrphaned({
    logGroupName: '/aws/lambda/my-function',
    functionName: 'my-function',
    functionExists: false,
    storedBytes: 1073741824,
    lastEventTimestamp: new Date('2026-01-01'),
    region,
    accountId: '123456789012',
    tags: {},
    monthlyCostUsd: 0.05,
    detectedAt: new Date('2026-06-09'),
    ...overrides,
  });
}

describe('LambdaLogGroupOrphaned', () => {
  it('exposes correct id and fields', () => {
    const logGroup = makeLogGroup();
    expect(logGroup.id).toBe('/aws/lambda/my-function');
    expect(logGroup.functionName).toBe('my-function');
  });

  it('exposes kind', () => {
    expect(makeLogGroup().kind).toBe('lambda-loggroup-orphaned');
  });

  it('wasteReason references the missing function', () => {
    expect(makeLogGroup({ functionName: 'checkout-worker' }).wasteReason).toBe(
      'function checkout-worker no longer exists',
    );
  });

  it('costEstimate returns the monthly cost and the stored size in GB', () => {
    const logGroup = makeLogGroup({ storedBytes: 1073741824, monthlyCostUsd: 0.05 });
    expect(logGroup.costEstimate.monthlyCostUsd).toBe(0.05);
    expect(logGroup.costEstimate.description).toBe('1.00 GB CW logs (orphaned Lambda log group)');
  });

  it('exposes a null lastEventTimestamp when the log group never received events', () => {
    expect(makeLogGroup({ lastEventTimestamp: null }).lastEventTimestamp).toBeNull();
  });

  it('exposes the remaining props', () => {
    const lastEventTimestamp = new Date('2026-05-01');
    const detectedAt = new Date('2026-06-09');
    const logGroup = makeLogGroup({
      functionExists: true,
      storedBytes: 2048,
      lastEventTimestamp,
      region,
      accountId: '999999999999',
      tags: { env: 'prod' },
      detectedAt,
    });
    expect(logGroup.functionExists).toBe(true);
    expect(logGroup.storedBytes).toBe(2048);
    expect(logGroup.lastEventTimestamp).toBe(lastEventTimestamp);
    expect(logGroup.region).toBe(region);
    expect(logGroup.accountId).toBe('999999999999');
    expect(logGroup.tags).toEqual({ env: 'prod' });
    expect(logGroup.detectedAt).toBe(detectedAt);
  });
});
