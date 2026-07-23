// SPDX-License-Identifier: Apache-2.0
import { S3BucketEmpty } from '../entities/s3-bucket-empty.entity';
import type { S3BucketEmptyProps } from '../entities/s3-bucket-empty.entity';
import { S3BucketEmptyPolicy } from './s3-bucket-empty.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeBucket(overrides: Partial<S3BucketEmptyProps> = {}): S3BucketEmpty {
  return new S3BucketEmpty({
    bucketName: 'bucket-1',
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('S3BucketEmptyPolicy', () => {
  const policy = new S3BucketEmptyPolicy();

  it('flags an old empty bucket', () => {
    const verdict = policy.evaluate(makeBucket(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('no objects');
  });

  it('does not flag a bucket created within the grace period', () => {
    const verdict = policy.evaluate(makeBucket({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a bucket created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeBucket({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a bucket carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeBucket({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
