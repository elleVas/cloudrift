// SPDX-License-Identifier: Apache-2.0
import { IamPolicyUnattached } from './iam-policy-unattached.entity';
import type { IamPolicyUnattachedProps } from './iam-policy-unattached.entity';

function makePolicy(overrides: Partial<IamPolicyUnattachedProps> = {}): IamPolicyUnattached {
  return new IamPolicyUnattached({
    policyId: 'ANPA123',
    policyName: 'old-deploy-policy',
    arn: 'arn:aws:iam::123456789012:policy/old-deploy-policy',
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-15'),
    tags: {},
    ...overrides,
  });
}

describe('IamPolicyUnattached', () => {
  it('exposes correct id and fields', () => {
    const policy = makePolicy();
    expect(policy.id).toBe('ANPA123');
    expect(policy.policyName).toBe('old-deploy-policy');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const policy = makePolicy();
    expect(policy.kind).toBe('iam-policy-unattached');
    expect(policy.hygieneReason).toContain('not attached');
    expect(policy.severity).toBe('info');
  });
});
