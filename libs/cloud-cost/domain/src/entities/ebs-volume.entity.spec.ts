// SPDX-License-Identifier: Apache-2.0
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
    wasteReason: 'unattached, created 524d ago',
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

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('eu-west-1');
    const createTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const volume = new EbsVolume({
      volumeId: 'vol-9',
      region,
      accountId: '999999999999',
      sizeGb: 200,
      volumeType: 'gp2',
      state: 'available',
      createTime,
      detectedAt,
      tags: { env: 'prod' },
      monthlyCostUsd: 16,
      wasteReason: 'unattached, created 524d ago',
    });
    expect(volume.region).toBe(region);
    expect(volume.accountId).toBe('999999999999');
    expect(volume.sizeGb).toBe(200);
    expect(volume.volumeType).toBe('gp2');
    expect(volume.state).toBe('available');
    expect(volume.createTime).toBe(createTime);
    expect(volume.detectedAt).toBe(detectedAt);
    expect(volume.tags).toEqual({ env: 'prod' });
    expect(volume.wasteReason).toBe('unattached, created 524d ago');
    expect(volume.kind).toBe('ebs-volume');
  });
});
