// SPDX-License-Identifier: Apache-2.0
import { IamPolicyUnattached } from '../entities/iam-policy-unattached.entity';
import type { IamPolicyUnattachedProps } from '../entities/iam-policy-unattached.entity';
import { IamPolicyUnattachedPolicy } from './iam-policy-unattached.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makePolicy(overrides: Partial<IamPolicyUnattachedProps> = {}): IamPolicyUnattached {
  return new IamPolicyUnattached({
    policyId: 'ANPA1',
    policyName: 'policy-1',
    arn: 'arn:aws:iam::123456789012:policy/policy-1',
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('IamPolicyUnattachedPolicy', () => {
  const policy = new IamPolicyUnattachedPolicy();

  it('flags an old unattached policy', () => {
    const verdict = policy.evaluate(makePolicy(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('not attached');
  });

  it('does not flag a policy created within the grace period', () => {
    const verdict = policy.evaluate(makePolicy({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a policy created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makePolicy({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a policy carrying the ignore tag', () => {
    const verdict = policy.evaluate(makePolicy({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain(DEFAULT_IGNORE_TAG);
  });
});
