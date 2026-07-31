// SPDX-License-Identifier: Apache-2.0
import { S3AccountPublicAccessBlockDisabled } from '../entities/s3-account-public-access-block-disabled.entity';
import { S3AccountPublicAccessBlockDisabledPolicy } from './s3-account-public-access-block-disabled.policy';

describe('S3AccountPublicAccessBlockDisabledPolicy', () => {
  it('flags — the scanner only emits accounts where the block is not fully enabled', () => {
    const finding = new S3AccountPublicAccessBlockDisabled({ accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new S3AccountPublicAccessBlockDisabledPolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new S3AccountPublicAccessBlockDisabled({ accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new S3AccountPublicAccessBlockDisabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
