import { EbsVolume } from './ebs-volume.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

function makeVolume(state: 'available' | 'in-use' = 'available'): EbsVolume {
  return new EbsVolume({
    volumeId: 'vol-0abc123',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state,
    createTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Environment: 'staging' },
    monthlyCostUsd: 8,
  });
}

describe('EbsVolume', () => {
  it('exposes the volume id', () => {
    expect(makeVolume().id).toBe('vol-0abc123');
  });

  it('isUnattached returns true when state is available', () => {
    expect(makeVolume('available').isUnattached()).toBe(true);
  });

  it('isUnattached returns false when state is in-use', () => {
    expect(makeVolume('in-use').isUnattached()).toBe(false);
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeVolume().costEstimate.monthlyCostUsd).toBe(8);
  });

  it('costEstimate description references the volume details', () => {
    expect(makeVolume().costEstimate.description).toContain('gp3');
  });

  it('equals another volume with the same id', () => {
    expect(makeVolume().equals(makeVolume())).toBe(true);
  });
});
