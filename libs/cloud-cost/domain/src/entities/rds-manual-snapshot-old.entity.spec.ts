// SPDX-License-Identifier: Apache-2.0
import { RdsManualSnapshotOld } from './rds-manual-snapshot-old.entity';
import type { RdsManualSnapshotOldProps } from './rds-manual-snapshot-old.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeSnapshot(overrides: Partial<RdsManualSnapshotOldProps> = {}): RdsManualSnapshotOld {
  return new RdsManualSnapshotOld({
    snapshotId: 'my-db-final-snapshot',
    region,
    accountId: '123456789012',
    sourceDbInstanceId: 'my-db',
    engine: 'postgres',
    allocatedStorageGb: 100,
    snapshotCreateTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 9.5,
    ...overrides,
  });
}

describe('RdsManualSnapshotOld', () => {
  it('exposes correct id and fields', () => {
    const snap = makeSnapshot();
    expect(snap.id).toBe('my-db-final-snapshot');
    expect(snap.sourceDbInstanceId).toBe('my-db');
    expect(snap.engine).toBe('postgres');
  });

  it('exposes kind and wasteReason', () => {
    expect(makeSnapshot().kind).toBe('rds-manual-snapshot-old');
    expect(makeSnapshot().wasteReason).toContain('grace period');
  });

  it('costEstimate description references the allocated storage', () => {
    expect(makeSnapshot().costEstimate.description).toContain('100 GB');
  });
});
