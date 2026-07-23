// SPDX-License-Identifier: Apache-2.0
import { IamAccessKeyStale } from '../entities/iam-access-key-stale.entity';
import type { IamAccessKeyStaleProps } from '../entities/iam-access-key-stale.entity';
import { IamAccessKeyStalePolicy, DEFAULT_ACCESS_KEY_MAX_AGE_DAYS } from './iam-access-key-stale.policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeKey(overrides: Partial<IamAccessKeyStaleProps> = {}): IamAccessKeyStale {
  return new IamAccessKeyStale({
    accessKeyId: 'AKIA1',
    userName: 'user-1',
    status: 'Active',
    accountId: '123456789012',
    createdAt: now,
    detectedAt: now,
    tags: {},
    ...overrides,
  });
}

describe('IamAccessKeyStalePolicy', () => {
  const policy = new IamAccessKeyStalePolicy();

  it('does not flag a key created just now', () => {
    const verdict = policy.evaluate(makeKey(), now);
    expect(verdict.flagged).toBe(false);
  });

  it('does not flag a key younger than the default rotation window', () => {
    const createdAt = new Date(now.getTime() - (DEFAULT_ACCESS_KEY_MAX_AGE_DAYS - 1) * MS_PER_DAY);
    const verdict = policy.evaluate(makeKey({ createdAt }), now);
    expect(verdict.flagged).toBe(false);
  });

  it('flags a key older than the default rotation window', () => {
    const createdAt = new Date(now.getTime() - (DEFAULT_ACCESS_KEY_MAX_AGE_DAYS + 1) * MS_PER_DAY);
    const verdict = policy.evaluate(makeKey({ createdAt }), now);
    expect(verdict.flagged).toBe(true);
  });

  it('honors a custom minAgeDays override', () => {
    const custom = new IamAccessKeyStalePolicy({ minAgeDays: 10 });
    const createdAt = new Date(now.getTime() - 15 * MS_PER_DAY);
    expect(custom.evaluate(makeKey({ createdAt }), now).flagged).toBe(true);
  });
});
