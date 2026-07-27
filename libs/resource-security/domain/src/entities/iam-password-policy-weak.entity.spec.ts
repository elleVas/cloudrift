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

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-07-23');
    const finding = makeFinding({ accountId: '999999999999', exists: true, detectedAt, tags: { env: 'prod' } });
    expect(finding.accountId).toBe('999999999999');
    expect(finding.exists).toBe(true);
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
  });

  it('flags a missing max password age and weak reuse prevention', () => {
    const finding = makeFinding({
      exists: true,
      minimumPasswordLength: 14,
      requireSymbols: true,
      requireNumbers: true,
      requireUppercaseCharacters: true,
      requireLowercaseCharacters: true,
      maxPasswordAge: undefined,
      passwordReusePrevention: 5,
    });
    expect(finding.riskReason).toContain('max password age not set to <= 90 days');
    expect(finding.riskReason).toContain('password reuse prevention below 24');
  });

  it('riskReason reports a met baseline when the policy meets it', () => {
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
    expect(finding.riskReason).toBe('password policy meets CIS baseline');
  });

  const baseline = {
    exists: true,
    minimumPasswordLength: 14,
    requireSymbols: true,
    requireNumbers: true,
    requireUppercaseCharacters: true,
    requireLowercaseCharacters: true,
    maxPasswordAge: 90,
    passwordReusePrevention: 24,
  };

  it('flags numbers not required in isolation', () => {
    const finding = makeFinding({ ...baseline, requireNumbers: false });
    expect(finding.riskReason).toContain('numbers not required');
  });

  it('flags uppercase characters not required in isolation', () => {
    const finding = makeFinding({ ...baseline, requireUppercaseCharacters: false });
    expect(finding.riskReason).toContain('uppercase characters not required');
  });

  it('flags lowercase characters not required in isolation', () => {
    const finding = makeFinding({ ...baseline, requireLowercaseCharacters: false });
    expect(finding.riskReason).toContain('lowercase characters not required');
  });

  it('flags a max password age above the baseline', () => {
    const finding = makeFinding({ ...baseline, maxPasswordAge: 91 });
    expect(finding.riskReason).toContain('max password age not set to <= 90 days');
  });

  it('flags password reuse prevention exactly at the boundary minus one', () => {
    const finding = makeFinding({ ...baseline, passwordReusePrevention: 23 });
    expect(finding.riskReason).toContain('password reuse prevention below 24');
  });

  it('does not flag password reuse prevention exactly at the baseline', () => {
    const finding = makeFinding({ ...baseline, passwordReusePrevention: 24 });
    expect(finding.riskReason).not.toContain('password reuse prevention');
  });

  it('flags an unset password reuse prevention as below the baseline', () => {
    const finding = makeFinding({ ...baseline, passwordReusePrevention: undefined });
    expect(finding.riskReason).toContain('password reuse prevention below 24');
  });

  it('flags an unset minimum password length as below the baseline', () => {
    const finding = makeFinding({ ...baseline, minimumPasswordLength: undefined });
    expect(finding.riskReason).toContain('minimum length below 14');
  });
});
