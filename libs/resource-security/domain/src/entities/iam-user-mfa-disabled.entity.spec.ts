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

  it('exposes the remaining props', () => {
    const createdAt = new Date('2024-06-01');
    const detectedAt = new Date('2026-07-23');
    const finding = makeFinding({
      userName: 'bob',
      arn: 'arn:aws:iam::999999999999:user/bob',
      accountId: '999999999999',
      createdAt,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(finding.userName).toBe('bob');
    expect(finding.arn).toBe('arn:aws:iam::999999999999:user/bob');
    expect(finding.accountId).toBe('999999999999');
    expect(finding.createdAt).toBe(createdAt);
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
  });
});
