// SPDX-License-Identifier: Apache-2.0
import { S3BucketEmpty } from './s3-bucket-empty.entity';
import type { S3BucketEmptyProps } from './s3-bucket-empty.entity';

function makeBucket(overrides: Partial<S3BucketEmptyProps> = {}): S3BucketEmpty {
  return new S3BucketEmpty({
    bucketName: 'old-project-artifacts',
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('S3BucketEmpty', () => {
  it('exposes correct id and fields', () => {
    const bucket = makeBucket();
    expect(bucket.id).toBe('old-project-artifacts');
    expect(bucket.bucketName).toBe('old-project-artifacts');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const bucket = makeBucket();
    expect(bucket.kind).toBe('s3-bucket-empty');
    expect(bucket.hygieneReason).toContain('no objects');
    expect(bucket.severity).toBe('info');
  });
});
