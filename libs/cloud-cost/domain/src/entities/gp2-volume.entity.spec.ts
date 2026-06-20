import { Gp2Volume } from './gp2-volume.entity';
import type { Gp2VolumeProps } from './gp2-volume.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeVolume(overrides: Partial<Gp2VolumeProps> = {}): Gp2Volume {
  return new Gp2Volume({
    volumeId: 'vol-0abc123',
    region,
    accountId: '123456789012',
    sizeGb: 100,
    createTime: new Date('2024-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'prod' },
    monthlyCostUsd: 4.2,
    ...overrides,
  });
}

describe('Gp2Volume', () => {
  it('exposes correct id and fields', () => {
    const volume = makeVolume();
    expect(volume.id).toBe('vol-0abc123');
    expect(volume.sizeGb).toBe(100);
    expect(volume.tags).toEqual({ Env: 'prod' });
  });

  it('monthlySavingUsd returns the stored monthlyCostUsd', () => {
    expect(makeVolume({ monthlyCostUsd: 4.2 }).monthlySavingUsd).toBe(4.2);
  });

  it('wasteReason mentions the dollar saving', () => {
    expect(makeVolume({ monthlyCostUsd: 4.2 }).wasteReason).toContain('saves $4.20/mo');
  });

  it('exposes kind ebs-gp2-upgrade', () => {
    expect(makeVolume().kind).toBe('ebs-gp2-upgrade');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeVolume().costEstimate.monthlyCostUsd).toBe(4.2);
  });

  it('costEstimate description references the gp2 to gp3 saving', () => {
    expect(makeVolume().costEstimate.description).toContain('gp2 → gp3');
  });
});
