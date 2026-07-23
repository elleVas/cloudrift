// SPDX-License-Identifier: Apache-2.0
import { IamAccessKeyRotationOverdue } from '../entities/iam-access-key-rotation-overdue.entity';
import type { IamAccessKeyRotationOverdueProps } from '../entities/iam-access-key-rotation-overdue.entity';
import { IamAccessKeyRotationOverduePolicy, DEFAULT_ACCESS_KEY_MAX_AGE_DAYS } from './iam-access-key-rotation-overdue.policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeFinding(overrides: Partial<IamAccessKeyRotationOverdueProps> = {}): IamAccessKeyRotationOverdue {
  return new IamAccessKeyRotationOverdue({
    accessKeyId: 'AKIA1',
    userName: 'alice',
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? now,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('IamAccessKeyRotationOverduePolicy', () => {
  const policy = new IamAccessKeyRotationOverduePolicy();

  it('does not flag a key created within the rotation window', () => {
    const createdAt = new Date(now.getTime() - (DEFAULT_ACCESS_KEY_MAX_AGE_DAYS - 1) * MS_PER_DAY);
    expect(policy.evaluate(makeFinding({ createdAt }), now).flagged).toBe(false);
  });

  it('flags a key older than the rotation window', () => {
    const createdAt = new Date(now.getTime() - (DEFAULT_ACCESS_KEY_MAX_AGE_DAYS + 1) * MS_PER_DAY);
    expect(policy.evaluate(makeFinding({ createdAt }), now).flagged).toBe(true);
  });
});
