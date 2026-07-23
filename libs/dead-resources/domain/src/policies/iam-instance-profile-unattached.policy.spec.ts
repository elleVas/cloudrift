// SPDX-License-Identifier: Apache-2.0
import { IamInstanceProfileUnattached } from '../entities/iam-instance-profile-unattached.entity';
import type { IamInstanceProfileUnattachedProps } from '../entities/iam-instance-profile-unattached.entity';
import { IamInstanceProfileUnattachedPolicy } from './iam-instance-profile-unattached.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeProfile(overrides: Partial<IamInstanceProfileUnattachedProps> = {}): IamInstanceProfileUnattached {
  return new IamInstanceProfileUnattached({
    instanceProfileId: 'AIPA1',
    instanceProfileName: 'profile-1',
    arn: 'arn:aws:iam::123456789012:instance-profile/profile-1',
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('IamInstanceProfileUnattachedPolicy', () => {
  const policy = new IamInstanceProfileUnattachedPolicy();

  it('flags an old unattached instance profile', () => {
    const verdict = policy.evaluate(makeProfile(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('not attached');
  });

  it('does not flag a profile created within the grace period', () => {
    const verdict = policy.evaluate(makeProfile({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a profile created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeProfile({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a profile carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeProfile({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
