// SPDX-License-Identifier: Apache-2.0
import { IamRootAccessKeyActive } from '../entities/iam-root-access-key-active.entity';
import type { IamRootAccessKeyActiveProps } from '../entities/iam-root-access-key-active.entity';
import { IamRootAccessKeyActivePolicy } from './iam-root-access-key-active.policy';

function makeFinding(overrides: Partial<IamRootAccessKeyActiveProps> = {}): IamRootAccessKeyActive {
  return new IamRootAccessKeyActive({
    accountId: '123456789012',
    accessKeysPresent: true,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamRootAccessKeyActivePolicy', () => {
  const policy = new IamRootAccessKeyActivePolicy();

  it('flags when root has active access keys', () => {
    expect(policy.evaluate(makeFinding({ accessKeysPresent: true })).flagged).toBe(true);
  });

  it('does not flag when root has no access keys', () => {
    expect(policy.evaluate(makeFinding({ accessKeysPresent: false })).flagged).toBe(false);
  });
});
