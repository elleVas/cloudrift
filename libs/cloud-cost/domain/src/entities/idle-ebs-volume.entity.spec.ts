// SPDX-License-Identifier: Apache-2.0
import { IdleEbsVolume } from './idle-ebs-volume.entity';
import type { IdleEbsVolumeProps } from './idle-ebs-volume.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeVolume(overrides: Partial<IdleEbsVolumeProps> = {}): IdleEbsVolume {
  return new IdleEbsVolume({
    volumeId: 'vol-0idle123',
    region,
    accountId: '123456789012',
    sizeGb: 50,
    volumeType: 'gp3',
    attachedInstanceId: 'i-0abc123',
    readOps: 0,
    writeOps: 0,
    metricWindowHours: 336,
    createTime: new Date('2024-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 4,
    ...overrides,
  });
}

describe('IdleEbsVolume', () => {
  it('exposes correct id and fields', () => {
    const volume = makeVolume();
    expect(volume.id).toBe('vol-0idle123');
    expect(volume.attachedInstanceId).toBe('i-0abc123');
    expect(volume.volumeType).toBe('gp3');
  });

  it('totalOps sums readOps and writeOps', () => {
    expect(makeVolume({ readOps: 3, writeOps: 5 }).totalOps()).toBe(8);
  });

  it('totalOps returns zero when there is no I/O', () => {
    expect(makeVolume({ readOps: 0, writeOps: 0 }).totalOps()).toBe(0);
  });

  it('wasteReason mentions the observation window in hours', () => {
    expect(makeVolume({ metricWindowHours: 336 }).wasteReason).toContain('336h');
  });

  it('exposes kind ebs-idle', () => {
    expect(makeVolume().kind).toBe('ebs-idle');
  });

  it('costEstimate returns the stored monthlyCostUsd and references idle EBS', () => {
    expect(makeVolume().costEstimate.monthlyCostUsd).toBe(4);
    expect(makeVolume().costEstimate.description).toContain('idle EBS');
  });
});
