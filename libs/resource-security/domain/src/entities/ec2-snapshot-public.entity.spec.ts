// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2SnapshotPublic } from './ec2-snapshot-public.entity';
import type { Ec2SnapshotPublicProps } from './ec2-snapshot-public.entity';

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

describe('Ec2SnapshotPublic', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('snap-1');
    expect(finding.kind).toBe('ec2-snapshot-public');
    expect(finding.severity).toBe('critical');
  });

  it('riskReason mentions the public restore permission', () => {
    expect(makeFinding().riskReason).toContain('createVolumePermission: all');
  });

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-07-23');
    const region = AwsRegion.create('eu-west-1');
    const finding = makeFinding({ volumeId: 'vol-9', region, accountId: '999999999999', detectedAt, tags: { env: 'prod' } });
    expect(finding.volumeId).toBe('vol-9');
    expect(finding.region).toBe(region);
    expect(finding.accountId).toBe('999999999999');
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
  });
});
