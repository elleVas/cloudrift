// SPDX-License-Identifier: Apache-2.0
import { groupByKind } from './group-by-kind';
import { RESOURCE_KINDS, type WastedResource } from './wasted-resource';
import { AwsRegion } from './value-objects/aws-region.value-object';
import { CostEstimate } from './value-objects/cost-estimate.value-object';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<WastedResource> = {}): WastedResource {
  return {
    id: 'res-1',
    kind: 'ebs-volume',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-27'),
    tags: {},
    costEstimate: CostEstimate.of(1),
    wasteReason: 'unattached',
    ...overrides,
  };
}

describe('groupByKind', () => {
  it('buckets findings under their own kind', () => {
    const volume = makeFinding({ id: 'vol-1', kind: 'ebs-volume' });
    const eip = makeFinding({ id: 'eip-1', kind: 'elastic-ip' });

    const grouped = groupByKind([volume, eip]);

    expect(grouped['ebs-volume']).toEqual([volume]);
    expect(grouped['elastic-ip']).toEqual([eip]);
  });

  it('returns an empty array for every kind with no findings', () => {
    const grouped = groupByKind([]);

    for (const kind of RESOURCE_KINDS) {
      expect(grouped[kind]).toEqual([]);
    }
  });

  it('preserves insertion order within a bucket', () => {
    const first = makeFinding({ id: 'a' });
    const second = makeFinding({ id: 'b' });

    const grouped = groupByKind([first, second]);

    expect(grouped['ebs-volume']).toEqual([first, second]);
  });
});
