// SPDX-License-Identifier: Apache-2.0
import { IamUserInactive } from '../entities/iam-user-inactive.entity';
import type { IamUserInactiveProps } from '../entities/iam-user-inactive.entity';
import { IamUserInactivePolicy } from './iam-user-inactive.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const longAgo = new Date(now.getTime() - 365 * MS_PER_DAY);

function makeUser(overrides: Partial<IamUserInactiveProps> = {}): IamUserInactive {
  return new IamUserInactive({
    userId: 'AIDA1',
    userName: 'user-1',
    arn: 'arn:aws:iam::123456789012:user/user-1',
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? longAgo,
    lastActivityAt: 'lastActivityAt' in overrides ? overrides.lastActivityAt : longAgo,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('IamUserInactivePolicy', () => {
  const policy = new IamUserInactivePolicy();

  it('flags a user with no activity in over 90 days', () => {
    const verdict = policy.evaluate(makeUser({ lastActivityAt: new Date(now.getTime() - 100 * MS_PER_DAY) }), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('no activity since');
  });

  it('does not flag a user active within the last 90 days', () => {
    const verdict = policy.evaluate(makeUser({ lastActivityAt: new Date(now.getTime() - 10 * MS_PER_DAY) }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('active within the last 90d');
  });

  it('flags a user who has never logged in, once past the creation grace period', () => {
    const verdict = policy.evaluate(makeUser({ lastActivityAt: undefined, createdAt: longAgo }), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toBe('never used since creation');
  });

  it('does not flag a brand-new user with no activity yet (creation grace period)', () => {
    const recentlyCreated = new Date(now.getTime() - (DEFAULT_MIN_AGE_DAYS - 1) * MS_PER_DAY);
    const verdict = policy.evaluate(makeUser({ lastActivityAt: undefined, createdAt: recentlyCreated }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('honours a custom inactivityDays threshold', () => {
    const strict = new IamUserInactivePolicy({}, 5);
    const verdict = strict.evaluate(makeUser({ lastActivityAt: new Date(now.getTime() - 10 * MS_PER_DAY) }), now);
    expect(verdict.flagged).toBe(true);
  });

  it('does not flag a user carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeUser({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain(DEFAULT_IGNORE_TAG);
  });
});
