// SPDX-License-Identifier: Apache-2.0
import { S3BucketPublic } from './s3-bucket-public.entity';
import type { S3BucketPublicProps } from './s3-bucket-public.entity';

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

describe('S3BucketPublic', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('my-bucket');
    expect(finding.kind).toBe('s3-bucket-public');
    expect(finding.severity).toBe('critical');
  });

  it('riskReason joins all public-exposure reasons', () => {
    const finding = makeFinding({ publicVia: ['bucket policy allows public access', 'bucket ACL grants public access'] });
    expect(finding.riskReason).toBe('bucket policy allows public access; bucket ACL grants public access');
  });
});
