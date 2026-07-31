// SPDX-License-Identifier: Apache-2.0
import { S3BucketVersioningDisabled } from './s3-bucket-versioning-disabled.entity';
import type { S3BucketVersioningDisabledProps } from './s3-bucket-versioning-disabled.entity';

function makeFinding(overrides: Partial<S3BucketVersioningDisabledProps> = {}): S3BucketVersioningDisabled {
  return new S3BucketVersioningDisabled({
    bucketName: 'my-bucket',
    accountId: '123456789012',
    issue: 'versioning-disabled',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('S3BucketVersioningDisabled', () => {
  it('exposes id (bucketName), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('my-bucket');
    expect(finding.kind).toBe('s3-bucket-versioning-disabled');
    expect(finding.severity).toBe('warning');
  });

  it('describes the versioning-disabled reason', () => {
    const finding = makeFinding({ issue: 'versioning-disabled' });
    expect(finding.riskReason).toContain('not enabled');
  });

  it('describes the mfa-delete-disabled reason', () => {
    const finding = makeFinding({ issue: 'mfa-delete-disabled' });
    expect(finding.riskReason).toContain('MFA Delete');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.bucketName).toBe('my-bucket');
    expect(finding.accountId).toBe('123456789012');
    expect(finding.tags).toEqual({ env: 'prod' });
  });
});
