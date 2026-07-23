// SPDX-License-Identifier: Apache-2.0
import { IamRoleUnused } from '../entities/iam-role-unused.entity';
import type { IamRoleUnusedProps } from '../entities/iam-role-unused.entity';
import { IamRoleUnusedPolicy, DEFAULT_ROLE_INACTIVITY_DAYS } from './iam-role-unused.policy';
import { DEFAULT_IGNORE_TAG } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);

function makeRole(overrides: Partial<IamRoleUnusedProps> = {}): IamRoleUnused {
  return new IamRoleUnused({
    roleId: 'AROA1',
    roleName: 'role-1',
    arn: 'arn:aws:iam::123456789012:role/role-1',
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    lastUsedAt: overrides.lastUsedAt,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('IamRoleUnusedPolicy', () => {
  const policy = new IamRoleUnusedPolicy();

  it('flags a role never used, old enough to be past grace period', () => {
    const verdict = policy.evaluate(makeRole({ lastUsedAt: undefined }), now);
    expect(verdict.flagged).toBe(true);
  });

  it('does not flag a role created within the grace period', () => {
    const verdict = policy.evaluate(makeRole({ createdAt: yesterday, lastUsedAt: undefined }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('does not flag a role assumed within the inactivity window', () => {
    const recentlyUsed = new Date(now.getTime() - (DEFAULT_ROLE_INACTIVITY_DAYS - 1) * MS_PER_DAY);
    const verdict = policy.evaluate(makeRole({ lastUsedAt: recentlyUsed }), now);
    expect(verdict.flagged).toBe(false);
  });

  it('flags a role not assumed for longer than the inactivity window', () => {
    const staleUse = new Date(now.getTime() - (DEFAULT_ROLE_INACTIVITY_DAYS + 1) * MS_PER_DAY);
    const verdict = policy.evaluate(makeRole({ lastUsedAt: staleUse }), now);
    expect(verdict.flagged).toBe(true);
  });

  it('does not flag a role carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeRole({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
