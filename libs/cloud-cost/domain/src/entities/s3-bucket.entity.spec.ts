import { S3Bucket } from './s3-bucket.entity';
import type { S3BucketProps } from './s3-bucket.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeBucket(overrides: Partial<S3BucketProps> = {}): S3Bucket {
  return new S3Bucket({
    bucketName: 'my-bucket',
    region,
    accountId: '123456789012',
    sizeBytes: 1024 ** 3,
    hasLifecyclePolicy: false,
    creationDate: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 0.0092,
    ...overrides,
  });
}

describe('S3Bucket', () => {
  it('exposes correct id and fields', () => {
    const bucket = makeBucket();
    expect(bucket.id).toBe('my-bucket');
    expect(bucket.sizeBytes).toBe(1024 ** 3);
    expect(bucket.tags).toEqual({ Env: 'dev' });
  });

  it('hasLifecyclePolicy returns false when not configured', () => {
    expect(makeBucket({ hasLifecyclePolicy: false }).hasLifecyclePolicy()).toBe(false);
  });

  it('hasLifecyclePolicy returns true when configured', () => {
    expect(makeBucket({ hasLifecyclePolicy: true }).hasLifecyclePolicy()).toBe(true);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeBucket().kind).toBe('s3-no-lifecycle');
    expect(makeBucket().wasteReason).toContain('lifecycle');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeBucket().costEstimate.monthlyCostUsd).toBe(0.0092);
  });

  it('costEstimate description references the bucket size', () => {
    expect(makeBucket().costEstimate.description).toContain('GB');
  });
});
