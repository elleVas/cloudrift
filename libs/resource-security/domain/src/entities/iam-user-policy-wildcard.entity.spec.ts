// SPDX-License-Identifier: Apache-2.0
import { IamUserPolicyWildcard } from './iam-user-policy-wildcard.entity';
import type { IamUserPolicyWildcardProps } from './iam-user-policy-wildcard.entity';

function makeFinding(overrides: Partial<IamUserPolicyWildcardProps> = {}): IamUserPolicyWildcard {
  return new IamUserPolicyWildcard({
    userName: 'alice',
    arn: 'arn:aws:iam::123456789012:user/alice',
    accountId: '123456789012',
    policyName: 'AdminAccess',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('IamUserPolicyWildcard', () => {
  it('exposes id (userName), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('alice');
    expect(finding.kind).toBe('iam-user-policy-wildcard');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ policyName: 'FullAccess', tags: { env: 'prod' } });
    expect(finding.arn).toBe('arn:aws:iam::123456789012:user/alice');
    expect(finding.policyName).toBe('FullAccess');
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('FullAccess');
  });
});
