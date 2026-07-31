// SPDX-License-Identifier: Apache-2.0
import { S3AccountPublicAccessBlockDisabled } from './s3-account-public-access-block-disabled.entity';
import type { S3AccountPublicAccessBlockDisabledProps } from './s3-account-public-access-block-disabled.entity';

function makeFinding(overrides: Partial<S3AccountPublicAccessBlockDisabledProps> = {}): S3AccountPublicAccessBlockDisabled {
  return new S3AccountPublicAccessBlockDisabled({ accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {}, ...overrides });
}

describe('S3AccountPublicAccessBlockDisabled', () => {
  it('exposes id (accountId), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012');
    expect(finding.kind).toBe('s3-account-public-access-block-disabled');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.accountId).toBe('123456789012');
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('Block Public Access');
  });
});
