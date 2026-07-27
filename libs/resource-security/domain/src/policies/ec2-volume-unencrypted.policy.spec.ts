// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2VolumeUnencrypted } from '../entities/ec2-volume-unencrypted.entity';
import { Ec2VolumeUnencryptedPolicy } from './ec2-volume-unencrypted.policy';

describe('Ec2VolumeUnencryptedPolicy', () => {
  it('flags an unencrypted volume', () => {
    const policy = new Ec2VolumeUnencryptedPolicy();
    const finding = new Ec2VolumeUnencrypted({
      volumeId: 'vol-1',
      region: AwsRegion.create('us-east-1'),
      accountId: '123456789012',
      detectedAt: new Date('2026-07-23'),
      tags: {},
    });
    expect(policy.evaluate(finding).flagged).toBe(true);
  });

  it('excludes a resource whose tag matches an excludeTagValues entry', () => {
    const policy = new Ec2VolumeUnencryptedPolicy({ excludeTagValues: { Environment: 'Sandbox' } });
    const finding = new Ec2VolumeUnencrypted({
      volumeId: 'vol-1',
      region: AwsRegion.create('us-east-1'),
      accountId: '123456789012',
      detectedAt: new Date('2026-07-23'),
      tags: { Environment: 'Sandbox' },
    });
    const verdict = policy.evaluate(finding);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toBe('excluded by tag Environment=Sandbox');
  });
});
