// SPDX-License-Identifier: Apache-2.0
import { IamRootMfaDisabled } from '../entities/iam-root-mfa-disabled.entity';
import type { IamRootMfaDisabledProps } from '../entities/iam-root-mfa-disabled.entity';
import { IamRootMfaDisabledPolicy } from './iam-root-mfa-disabled.policy';
import { DEFAULT_IGNORE_TAG } from './resource-security-policy';

function makeFinding(overrides: Partial<IamRootMfaDisabledProps> = {}): IamRootMfaDisabled {
  return new IamRootMfaDisabled({
    accountId: '123456789012',
    mfaEnabled: false,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamRootMfaDisabledPolicy', () => {
  const policy = new IamRootMfaDisabledPolicy();

  it('flags when root MFA is disabled', () => {
    expect(policy.evaluate(makeFinding({ mfaEnabled: false })).flagged).toBe(true);
  });

  it('does not flag when root MFA is enabled', () => {
    expect(policy.evaluate(makeFinding({ mfaEnabled: true })).flagged).toBe(false);
  });

  it('does not flag a finding carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeFinding({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }));
    expect(verdict.flagged).toBe(false);
  });
});
