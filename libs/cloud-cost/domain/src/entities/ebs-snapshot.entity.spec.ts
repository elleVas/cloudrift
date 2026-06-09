import { EbsSnapshot } from './ebs-snapshot.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

const snapshot = new EbsSnapshot({
  snapshotId: 'snap-0abc123',
  region,
  accountId: '123456789012',
  sourceVolumeId: 'vol-deleted',
  sizeGb: 100,
  startTime: new Date('2023-06-01'),
  detectedAt: new Date('2026-06-09'),
  description: 'backup',
  tags: { Project: 'old-app' },
  monthlyCostUsd: 5,
});

describe('EbsSnapshot', () => {
  it('exposes correct id and fields', () => {
    expect(snapshot.id).toBe('snap-0abc123');
    expect(snapshot.sourceVolumeId).toBe('vol-deleted');
    expect(snapshot.sizeGb).toBe(100);
    expect(snapshot.description).toBe('backup');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(snapshot.costEstimate.monthlyCostUsd).toBe(5);
  });

  it('costEstimate description references orphan snapshot', () => {
    expect(snapshot.costEstimate.description).toContain('orphan snapshot');
  });
});
