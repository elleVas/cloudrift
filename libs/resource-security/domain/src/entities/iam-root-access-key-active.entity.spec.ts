// SPDX-License-Identifier: Apache-2.0
import { IamRootAccessKeyActive } from './iam-root-access-key-active.entity';
import type { IamRootAccessKeyActiveProps } from './iam-root-access-key-active.entity';

function makeFinding(overrides: Partial<IamRootAccessKeyActiveProps> = {}): IamRootAccessKeyActive {
  return new IamRootAccessKeyActive({
    accountId: '123456789012',
    accessKeysPresent: true,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('IamRootAccessKeyActive', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012');
    expect(finding.kind).toBe('iam-root-access-key-active');
    expect(finding.severity).toBe('critical');
  });

  it('riskReason mentions the active access key', () => {
    expect(makeFinding().riskReason).toContain('active access key');
  });
});
