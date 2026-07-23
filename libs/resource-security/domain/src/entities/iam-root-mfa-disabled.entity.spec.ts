// SPDX-License-Identifier: Apache-2.0
import { IamRootMfaDisabled } from './iam-root-mfa-disabled.entity';
import type { IamRootMfaDisabledProps } from './iam-root-mfa-disabled.entity';

function makeFinding(overrides: Partial<IamRootMfaDisabledProps> = {}): IamRootMfaDisabled {
  return new IamRootMfaDisabled({
    accountId: '123456789012',
    mfaEnabled: false,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamRootMfaDisabled', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012');
    expect(finding.kind).toBe('iam-root-mfa-disabled');
    expect(finding.severity).toBe('critical');
  });

  it('riskReason explains the missing MFA device', () => {
    expect(makeFinding().riskReason).toContain('no MFA device');
  });
});
