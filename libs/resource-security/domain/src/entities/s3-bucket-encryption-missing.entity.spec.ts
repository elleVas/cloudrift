// SPDX-License-Identifier: Apache-2.0
import { S3BucketEncryptionMissing } from './s3-bucket-encryption-missing.entity';
import type { S3BucketEncryptionMissingProps } from './s3-bucket-encryption-missing.entity';

function makeFinding(overrides: Partial<S3BucketEncryptionMissingProps> = {}): S3BucketEncryptionMissing {
  return new S3BucketEncryptionMissing({
    bucketName: 'my-bucket',
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('S3BucketEncryptionMissing', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('my-bucket');
    expect(finding.kind).toBe('s3-bucket-encryption-missing');
    expect(finding.severity).toBe('warning');
  });
});
