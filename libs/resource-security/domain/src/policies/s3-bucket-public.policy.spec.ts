// SPDX-License-Identifier: Apache-2.0
import { S3BucketPublic } from '../entities/s3-bucket-public.entity';
import type { S3BucketPublicProps } from '../entities/s3-bucket-public.entity';
import { S3BucketPublicPolicy } from './s3-bucket-public.policy';

function makeFinding(overrides: Partial<S3BucketPublicProps> = {}): S3BucketPublic {
  return new S3BucketPublic({
    bucketName: 'my-bucket',
    accountId: '123456789012',
    publicVia: ['bucket policy allows public access'],
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('S3BucketPublicPolicy', () => {
  const policy = new S3BucketPublicPolicy();

  it('flags a bucket already confirmed public', () => {
    expect(policy.evaluate(makeFinding()).flagged).toBe(true);
  });
});
