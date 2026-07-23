// SPDX-License-Identifier: Apache-2.0
import { S3BucketEncryptionMissing } from '../entities/s3-bucket-encryption-missing.entity';
import { S3BucketEncryptionMissingPolicy } from './s3-bucket-encryption-missing.policy';

describe('S3BucketEncryptionMissingPolicy', () => {
  it('flags a bucket with no default encryption', () => {
    const policy = new S3BucketEncryptionMissingPolicy();
    const finding = new S3BucketEncryptionMissing({
      bucketName: 'my-bucket',
      accountId: '123456789012',
      detectedAt: new Date('2026-07-23'),
      tags: {},
    });
    expect(policy.evaluate(finding).flagged).toBe(true);
  });
});
