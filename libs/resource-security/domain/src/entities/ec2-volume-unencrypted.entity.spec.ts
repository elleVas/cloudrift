// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2VolumeUnencrypted } from './ec2-volume-unencrypted.entity';
import type { Ec2VolumeUnencryptedProps } from './ec2-volume-unencrypted.entity';

function makeFinding(overrides: Partial<Ec2VolumeUnencryptedProps> = {}): Ec2VolumeUnencrypted {
  return new Ec2VolumeUnencrypted({
    volumeId: 'vol-1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2VolumeUnencrypted', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('vol-1');
    expect(finding.kind).toBe('ec2-volume-unencrypted');
    expect(finding.severity).toBe('warning');
  });
});
