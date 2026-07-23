// SPDX-License-Identifier: Apache-2.0
import { IamUserMfaDisabled } from './iam-user-mfa-disabled.entity';
import type { IamUserMfaDisabledProps } from './iam-user-mfa-disabled.entity';

function makeFinding(overrides: Partial<IamUserMfaDisabledProps> = {}): IamUserMfaDisabled {
  return new IamUserMfaDisabled({
    userName: 'alice',
    arn: 'arn:aws:iam::123456789012:user/alice',
    accountId: '123456789012',
    createdAt: new Date('2024-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamUserMfaDisabled', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('arn:aws:iam::123456789012:user/alice');
    expect(finding.kind).toBe('iam-user-mfa-disabled');
    expect(finding.severity).toBe('warning');
  });

  it('riskReason mentions the missing MFA device', () => {
    expect(makeFinding().riskReason).toContain('no MFA device');
  });
});
