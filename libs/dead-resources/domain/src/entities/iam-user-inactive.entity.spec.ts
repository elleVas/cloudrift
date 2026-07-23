// SPDX-License-Identifier: Apache-2.0
import { IamUserInactive } from './iam-user-inactive.entity';
import type { IamUserInactiveProps } from './iam-user-inactive.entity';

function makeUser(overrides: Partial<IamUserInactiveProps> = {}): IamUserInactive {
  return new IamUserInactive({
    userId: 'AIDA123',
    userName: 'old-service-account',
    arn: 'arn:aws:iam::123456789012:user/old-service-account',
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    lastActivityAt: new Date('2026-01-01'),
    detectedAt: new Date('2026-07-15'),
    tags: {},
    ...overrides,
  });
}

describe('IamUserInactive', () => {
  it('exposes correct id and fields', () => {
    const user = makeUser();
    expect(user.id).toBe('AIDA123');
    expect(user.userName).toBe('old-service-account');
    expect(user.arn).toContain('old-service-account');
  });

  it('exposes kind and severity', () => {
    expect(makeUser().kind).toBe('iam-user-inactive');
    expect(makeUser().severity).toBe('warning');
  });

  it('hygieneReason references the last activity date when known', () => {
    expect(makeUser({ lastActivityAt: new Date('2026-01-01') }).hygieneReason).toBe('no activity since 2026-01-01');
  });

  it('hygieneReason says "never used" when lastActivityAt is undefined', () => {
    expect(makeUser({ lastActivityAt: undefined }).hygieneReason).toBe('never used since creation');
  });

  it('does not implement region (IAM is a global service)', () => {
    expect((makeUser() as unknown as { region?: unknown }).region).toBeUndefined();
  });
});
