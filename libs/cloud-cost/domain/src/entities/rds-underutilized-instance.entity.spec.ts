// SPDX-License-Identifier: Apache-2.0
import { RdsUnderutilizedInstance } from './rds-underutilized-instance.entity';
import type { RdsUnderutilizedInstanceProps } from './rds-underutilized-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeInstance(
  overrides: Partial<RdsUnderutilizedInstanceProps> = {},
): RdsUnderutilizedInstance {
  return new RdsUnderutilizedInstance({
    dbInstanceIdentifier: 'db-0abc123',
    region,
    accountId: '123456789012',
    dbInstanceClass: 'db.m5.large',
    engine: 'postgres',
    avgCpuPercent: 3.2,
    maxCpuPercent: 6.5,
    windowDays: 14,
    instanceCreateTime: new Date('2024-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'prod' },
    monthlyCostUsd: 60,
    ...overrides,
  });
}

describe('RdsUnderutilizedInstance', () => {
  it('exposes correct id and fields', () => {
    const instance = makeInstance();
    expect(instance.id).toBe('db-0abc123');
    expect(instance.dbInstanceClass).toBe('db.m5.large');
    expect(instance.engine).toBe('postgres');
  });

  it('exposes avgCpuPercent and maxCpuPercent', () => {
    const instance = makeInstance({ avgCpuPercent: 3.2, maxCpuPercent: 6.5 });
    expect(instance.avgCpuPercent).toBe(3.2);
    expect(instance.maxCpuPercent).toBe(6.5);
  });

  it('wasteReason contains the storage I/O and connections advisory', () => {
    expect(makeInstance().wasteReason).toContain('verify storage I/O and connections');
  });

  it('exposes kind rds-underutilized', () => {
    expect(makeInstance().kind).toBe('rds-underutilized');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeInstance().costEstimate.monthlyCostUsd).toBe(60);
  });

  it('costEstimate description shows the real step-down when recommendedInstanceClass is set', () => {
    const instance = makeInstance({ recommendedInstanceClass: 'db.m5.medium' });
    expect(instance.recommendedInstanceClass).toBe('db.m5.medium');
    expect(instance.costEstimate.description).toContain('db.m5.large → db.m5.medium');
  });

  it('costEstimate description falls back to a manual-verification note with no recommendation', () => {
    expect(makeInstance().costEstimate.description).toContain('no derivable rightsizing price');
  });

  it('exposes the remaining props', () => {
    const instanceCreateTime = new Date('2023-01-01');
    const detectedAt = new Date('2026-06-09');
    const instance = makeInstance({ region, accountId: '999999999999', windowDays: 30, instanceCreateTime, detectedAt });
    expect(instance.region).toBe(region);
    expect(instance.accountId).toBe('999999999999');
    expect(instance.windowDays).toBe(30);
    expect(instance.instanceCreateTime).toBe(instanceCreateTime);
    expect(instance.detectedAt).toBe(detectedAt);
    expect(instance.tags).toEqual({ Env: 'prod' });
  });
});
