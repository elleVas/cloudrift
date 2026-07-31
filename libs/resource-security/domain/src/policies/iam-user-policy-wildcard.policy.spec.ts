// SPDX-License-Identifier: Apache-2.0
import { IamUserPolicyWildcard } from '../entities/iam-user-policy-wildcard.entity';
import { IamUserPolicyWildcardPolicy } from './iam-user-policy-wildcard.policy';

function makeFinding(tags: Record<string, string> = {}): IamUserPolicyWildcard {
  return new IamUserPolicyWildcard({
    userName: 'alice',
    arn: 'arn:aws:iam::123456789012:user/alice',
    accountId: '123456789012',
    policyName: 'AdminAccess',
    detectedAt: new Date('2026-07-31'),
    tags,
  });
}

describe('IamUserPolicyWildcardPolicy', () => {
  it('flags — the scanner only emits users with a wildcard-admin policy found', () => {
    expect(new IamUserPolicyWildcardPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    expect(new IamUserPolicyWildcardPolicy().evaluate(makeFinding({ 'cloudrift:ignore': 'true' })).flagged).toBe(false);
  });
});
