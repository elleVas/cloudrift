// SPDX-License-Identifier: Apache-2.0
import { IamRoleUnused } from './iam-role-unused.entity';
import type { IamRoleUnusedProps } from './iam-role-unused.entity';

function makeRole(overrides: Partial<IamRoleUnusedProps> = {}): IamRoleUnused {
  return new IamRoleUnused({
    roleId: 'AROA123',
    roleName: 'legacy-deploy-role',
    arn: 'arn:aws:iam::123456789012:role/legacy-deploy-role',
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    lastUsedAt: undefined,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamRoleUnused', () => {
  it('exposes correct id and fields', () => {
    const role = makeRole();
    expect(role.id).toBe('AROA123');
    expect(role.roleName).toBe('legacy-deploy-role');
  });

  it('exposes kind and severity', () => {
    expect(makeRole().kind).toBe('iam-role-unused');
    expect(makeRole().severity).toBe('warning');
  });

  it('hygieneReason reports "never assumed" when lastUsedAt is undefined', () => {
    expect(makeRole({ lastUsedAt: undefined }).hygieneReason).toContain('never assumed');
  });

  it('hygieneReason reports the last-used date otherwise', () => {
    const role = makeRole({ lastUsedAt: new Date('2026-01-15') });
    expect(role.hygieneReason).toContain('2026-01-15');
  });
});
