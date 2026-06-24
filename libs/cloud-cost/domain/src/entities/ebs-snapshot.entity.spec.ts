// SPDX-License-Identifier: Apache-2.0
import { EbsSnapshot } from './ebs-snapshot.entity';
import type { EbsSnapshotProps } from './ebs-snapshot.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeSnapshot(overrides: Partial<EbsSnapshotProps> = {}): EbsSnapshot {
  return new EbsSnapshot({
    snapshotId: 'snap-0abc123',
    region,
    accountId: '123456789012',
    sourceVolumeId: 'vol-deleted',
    sourceVolumeExists: false,
    sizeGb: 100,
    startTime: new Date('2023-06-01'),
    detectedAt: new Date('2026-06-09'),
    description: 'backup',
    tags: { Project: 'old-app' },
    monthlyCostUsd: 5,
    ...overrides,
  });
}

describe('EbsSnapshot', () => {
  it('exposes correct id and fields', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.id).toBe('snap-0abc123');
    expect(snapshot.sourceVolumeId).toBe('vol-deleted');
    expect(snapshot.sizeGb).toBe(100);
    expect(snapshot.description).toBe('backup');
  });

  it('isOrphan returns true when the source volume no longer exists', () => {
    expect(makeSnapshot({ sourceVolumeExists: false }).isOrphan()).toBe(true);
  });

  it('isOrphan returns false when the source volume still exists', () => {
    expect(makeSnapshot({ sourceVolumeExists: true }).isOrphan()).toBe(false);
  });

  it('exposes the AMI binding when present', () => {
    expect(makeSnapshot({ boundToAmiId: 'ami-123' }).boundToAmiId).toBe('ami-123');
    expect(makeSnapshot().boundToAmiId).toBeUndefined();
  });

  it('exposes kind and wasteReason', () => {
    expect(makeSnapshot().kind).toBe('ebs-snapshot');
    expect(makeSnapshot().wasteReason).toContain('source volume deleted');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeSnapshot().costEstimate.monthlyCostUsd).toBe(5);
  });

  it('costEstimate description references orphan snapshot', () => {
    expect(makeSnapshot().costEstimate.description).toContain('orphan snapshot');
  });
});
