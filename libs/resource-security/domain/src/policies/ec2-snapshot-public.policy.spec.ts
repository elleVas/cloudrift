// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2SnapshotPublic } from '../entities/ec2-snapshot-public.entity';
import type { Ec2SnapshotPublicProps } from '../entities/ec2-snapshot-public.entity';
import { Ec2SnapshotPublicPolicy } from './ec2-snapshot-public.policy';

function makeFinding(overrides: Partial<Ec2SnapshotPublicProps> = {}): Ec2SnapshotPublic {
  return new Ec2SnapshotPublic({
    snapshotId: 'snap-1',
    volumeId: 'vol-1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2SnapshotPublicPolicy', () => {
  const policy = new Ec2SnapshotPublicPolicy();

  it('flags a public snapshot', () => {
    expect(policy.evaluate(makeFinding()).flagged).toBe(true);
  });
});
