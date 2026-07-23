// SPDX-License-Identifier: Apache-2.0
import { IamPasswordPolicyWeak } from '../entities/iam-password-policy-weak.entity';
import type { IamPasswordPolicyWeakProps } from '../entities/iam-password-policy-weak.entity';
import { IamPasswordPolicyWeakPolicy } from './iam-password-policy-weak.policy';

function makeFinding(overrides: Partial<IamPasswordPolicyWeakProps> = {}): IamPasswordPolicyWeak {
  return new IamPasswordPolicyWeak({
    accountId: '123456789012',
    exists: false,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamPasswordPolicyWeakPolicy', () => {
  const policy = new IamPasswordPolicyWeakPolicy();

  it('flags a missing password policy', () => {
    expect(policy.evaluate(makeFinding({ exists: false })).flagged).toBe(true);
  });

  it('does not flag a policy meeting the CIS baseline', () => {
    const verdict = policy.evaluate(
      makeFinding({
        exists: true,
        minimumPasswordLength: 14,
        requireSymbols: true,
        requireNumbers: true,
        requireUppercaseCharacters: true,
        requireLowercaseCharacters: true,
        maxPasswordAge: 90,
        passwordReusePrevention: 24,
      }),
    );
    expect(verdict.flagged).toBe(false);
  });
});
