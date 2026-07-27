// SPDX-License-Identifier: Apache-2.0
import { RdsInstance } from './rds-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

function makeInstance(status: 'stopped' | 'available' = 'stopped'): RdsInstance {
  return new RdsInstance({
    dbInstanceIdentifier: 'db-prod-01',
    region: AwsRegion.create('eu-west-1'),
    accountId: '123456789012',
    dbInstanceClass: 'db.t3.medium',
    engine: 'postgres',
    dbInstanceStatus: status,
    allocatedStorageGb: 100,
    storageType: 'gp2',
    multiAZ: false,
    detectedAt: new Date('2026-06-09'),
    tags: { Environment: 'production' },
    monthlyCostUsd: 12.8,
  });
}

describe('RdsInstance', () => {
  it('exposes the db instance identifier as id', () => {
    expect(makeInstance().id).toBe('db-prod-01');
  });

  it('isStopped returns true when status is stopped', () => {
    expect(makeInstance('stopped').isStopped()).toBe(true);
  });

  it('isStopped returns false when status is available', () => {
    expect(makeInstance('available').isStopped()).toBe(false);
  });

  it('costEstimate returns stored monthlyCostUsd', () => {
    expect(makeInstance().costEstimate.monthlyCostUsd).toBe(12.8);
  });

  it('costEstimate description references RDS storage', () => {
    expect(makeInstance().costEstimate.description).toContain('RDS storage');
  });

  it('equals another instance with the same identifier', () => {
    expect(makeInstance().equals(makeInstance())).toBe(true);
  });

  it('exposes engine, class, and multiAZ', () => {
    const db = makeInstance();
    expect(db.engine).toBe('postgres');
    expect(db.dbInstanceClass).toBe('db.t3.medium');
    expect(db.multiAZ).toBe(false);
  });

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('us-east-1');
    const detectedAt = new Date('2026-06-09');
    const db = new RdsInstance({
      dbInstanceIdentifier: 'db-9',
      region,
      accountId: '999999999999',
      dbInstanceClass: 'db.t3.large',
      engine: 'mysql',
      dbInstanceStatus: 'stopped',
      allocatedStorageGb: 200,
      storageType: 'gp3',
      multiAZ: true,
      detectedAt,
      tags: { env: 'prod' },
      monthlyCostUsd: 20,
    });
    expect(db.region).toBe(region);
    expect(db.accountId).toBe('999999999999');
    expect(db.dbInstanceStatus).toBe('stopped');
    expect(db.allocatedStorageGb).toBe(200);
    expect(db.storageType).toBe('gp3');
    expect(db.detectedAt).toBe(detectedAt);
    expect(db.tags).toEqual({ env: 'prod' });
    expect(db.kind).toBe('rds-instance');
    expect(db.wasteReason).toContain('stopped');
  });
});
