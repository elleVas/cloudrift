// SPDX-License-Identifier: Apache-2.0
import { S3BucketVersioningDisabled } from '../entities/s3-bucket-versioning-disabled.entity';
import { S3BucketVersioningDisabledPolicy } from './s3-bucket-versioning-disabled.policy';

describe('S3BucketVersioningDisabledPolicy', () => {
  it('flags — the scanner only emits buckets that already fail a condition', () => {
    const finding = new S3BucketVersioningDisabled({ bucketName: 'my-bucket', accountId: '123456789012', issue: 'versioning-disabled', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new S3BucketVersioningDisabledPolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new S3BucketVersioningDisabled({
      bucketName: 'my-bucket',
      accountId: '123456789012',
      issue: 'versioning-disabled',
      detectedAt: new Date('2026-07-31'),
      tags: { 'cloudrift:ignore': 'true' },
    });
    expect(new S3BucketVersioningDisabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
