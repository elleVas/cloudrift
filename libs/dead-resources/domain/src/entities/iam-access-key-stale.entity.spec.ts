// SPDX-License-Identifier: Apache-2.0
import { IamAccessKeyStale } from './iam-access-key-stale.entity';
import type { IamAccessKeyStaleProps } from './iam-access-key-stale.entity';

function makeKey(overrides: Partial<IamAccessKeyStaleProps> = {}): IamAccessKeyStale {
  return new IamAccessKeyStale({
    accessKeyId: 'AKIA123',
    userName: 'ci-deploy',
    status: 'Active',
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamAccessKeyStale', () => {
  it('exposes correct id and fields', () => {
    const key = makeKey();
    expect(key.id).toBe('AKIA123');
    expect(key.userName).toBe('ci-deploy');
    expect(key.status).toBe('Active');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const key = makeKey();
    expect(key.kind).toBe('iam-access-key-stale');
    expect(key.hygieneReason).toContain('not rotated since 2023-01-01');
    expect(key.severity).toBe('warning');
  });
});
