// SPDX-License-Identifier: Apache-2.0
import { IamInstanceProfileUnattached } from './iam-instance-profile-unattached.entity';
import type { IamInstanceProfileUnattachedProps } from './iam-instance-profile-unattached.entity';

function makeProfile(overrides: Partial<IamInstanceProfileUnattachedProps> = {}): IamInstanceProfileUnattached {
  return new IamInstanceProfileUnattached({
    instanceProfileId: 'AIPA123',
    instanceProfileName: 'legacy-ec2-profile',
    arn: 'arn:aws:iam::123456789012:instance-profile/legacy-ec2-profile',
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamInstanceProfileUnattached', () => {
  it('exposes correct id and fields', () => {
    const profile = makeProfile();
    expect(profile.id).toBe('AIPA123');
    expect(profile.instanceProfileName).toBe('legacy-ec2-profile');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const profile = makeProfile();
    expect(profile.kind).toBe('iam-instance-profile-unattached');
    expect(profile.hygieneReason).toContain('not attached');
    expect(profile.severity).toBe('info');
  });
});
