// SPDX-License-Identifier: Apache-2.0
import { AmiUnused } from './ami-unused.entity';
import type { AmiUnusedProps } from './ami-unused.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeAmi(overrides: Partial<AmiUnusedProps> = {}): AmiUnused {
  return new AmiUnused({
    imageId: 'ami-0abc123',
    region,
    accountId: '123456789012',
    name: 'my-ami',
    creationDate: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    inUse: false,
    totalSnapshotSizeGb: 20,
    tags: {},
    monthlyCostUsd: 1,
    ...overrides,
  });
}

describe('AmiUnused', () => {
  it('exposes correct id and fields', () => {
    const ami = makeAmi();
    expect(ami.id).toBe('ami-0abc123');
    expect(ami.name).toBe('my-ami');
    expect(ami.totalSnapshotSizeGb).toBe(20);
  });

  it('isUnused returns true when not referenced', () => {
    expect(makeAmi({ inUse: false }).isUnused()).toBe(true);
  });

  it('isUnused returns false when referenced', () => {
    expect(makeAmi({ inUse: true }).isUnused()).toBe(false);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeAmi().kind).toBe('ami-unused');
    expect(makeAmi().wasteReason).toContain('not referenced');
  });

  it('costEstimate description references the backing snapshot size', () => {
    expect(makeAmi().costEstimate.description).toContain('20 GB');
  });
});
