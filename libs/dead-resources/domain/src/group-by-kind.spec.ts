// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { groupByKind } from './group-by-kind';
import { DEAD_RESOURCE_KINDS, type DeadResource } from './dead-resource';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<DeadResource> = {}): DeadResource {
  return {
    id: 'finding-1',
    kind: 'ec2-keypair-unused',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-27'),
    tags: {},
    hygieneReason: 'not referenced by any running/stopped EC2 instance',
    severity: 'info',
    ...overrides,
  };
}

describe('groupByKind', () => {
  it('buckets findings under their own kind', () => {
    const keypair = makeFinding({ id: 'a', kind: 'ec2-keypair-unused' });
    const bucket = makeFinding({ id: 'b', kind: 's3-bucket-empty' });

    const grouped = groupByKind([keypair, bucket]);

    expect(grouped['ec2-keypair-unused']).toEqual([keypair]);
    expect(grouped['s3-bucket-empty']).toEqual([bucket]);
  });

  it('returns an empty array for every kind with no findings', () => {
    const grouped = groupByKind([]);

    for (const kind of DEAD_RESOURCE_KINDS) {
      expect(grouped[kind]).toEqual([]);
    }
  });

  it('preserves insertion order within a bucket', () => {
    const first = makeFinding({ id: 'a' });
    const second = makeFinding({ id: 'b' });

    const grouped = groupByKind([first, second]);

    expect(grouped['ec2-keypair-unused']).toEqual([first, second]);
  });
});
