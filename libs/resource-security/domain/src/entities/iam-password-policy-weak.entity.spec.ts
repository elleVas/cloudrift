// SPDX-License-Identifier: Apache-2.0
import { IamPasswordPolicyWeak } from './iam-password-policy-weak.entity';
import type { IamPasswordPolicyWeakProps } from './iam-password-policy-weak.entity';

function makeFinding(overrides: Partial<IamPasswordPolicyWeakProps> = {}): IamPasswordPolicyWeak {
  return new IamPasswordPolicyWeak({
    accountId: '123456789012',
    exists: false,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamPasswordPolicyWeak', () => {
  it('is weak when no policy exists', () => {
    const finding = makeFinding({ exists: false });
    expect(finding.isWeak).toBe(true);
    expect(finding.riskReason).toContain('no account password policy');
  });

  it('is weak when the baseline is not met', () => {
    const finding = makeFinding({
      exists: true,
      minimumPasswordLength: 8,
      requireSymbols: false,
      requireNumbers: true,
      requireUppercaseCharacters: true,
      requireLowercaseCharacters: true,
      maxPasswordAge: 90,
      passwordReusePrevention: 24,
    });
    expect(finding.isWeak).toBe(true);
    expect(finding.riskReason).toContain('minimum length below 14');
    expect(finding.riskReason).toContain('symbols not required');
  });

  it('is not weak when the CIS baseline is met', () => {
    const finding = makeFinding({
      exists: true,
      minimumPasswordLength: 14,
      requireSymbols: true,
      requireNumbers: true,
      requireUppercaseCharacters: true,
      requireLowercaseCharacters: true,
      maxPasswordAge: 90,
      passwordReusePrevention: 24,
    });
    expect(finding.isWeak).toBe(false);
  });

  it('exposes kind and severity', () => {
    expect(makeFinding().kind).toBe('iam-password-policy-weak');
    expect(makeFinding().severity).toBe('warning');
  });
});
