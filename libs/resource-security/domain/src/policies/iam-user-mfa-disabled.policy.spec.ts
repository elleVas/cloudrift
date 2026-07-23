// SPDX-License-Identifier: Apache-2.0
import { IamUserMfaDisabled } from '../entities/iam-user-mfa-disabled.entity';
import type { IamUserMfaDisabledProps } from '../entities/iam-user-mfa-disabled.entity';
import { IamUserMfaDisabledPolicy } from './iam-user-mfa-disabled.policy';
import { DEFAULT_IGNORE_TAG } from './resource-security-policy';

function makeFinding(overrides: Partial<IamUserMfaDisabledProps> = {}): IamUserMfaDisabled {
  return new IamUserMfaDisabled({
    userName: 'alice',
    arn: 'arn:aws:iam::123456789012:user/alice',
    accountId: '123456789012',
    createdAt: new Date('2024-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('IamUserMfaDisabledPolicy', () => {
  const policy = new IamUserMfaDisabledPolicy();

  it('flags a user with no MFA device', () => {
    expect(policy.evaluate(makeFinding()).flagged).toBe(true);
  });

  it('does not flag a user carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeFinding({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }));
    expect(verdict.flagged).toBe(false);
  });
});
