// SPDX-License-Identifier: Apache-2.0
import { S3MultipartUploadAbandoned } from './s3-multipart-upload-abandoned.entity';
import type { S3MultipartUploadAbandonedProps } from './s3-multipart-upload-abandoned.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeUpload(overrides: Partial<S3MultipartUploadAbandonedProps> = {}): S3MultipartUploadAbandoned {
  return new S3MultipartUploadAbandoned({
    uploadId: 'upload-abc123',
    region,
    accountId: '123456789012',
    bucketName: 'my-bucket',
    key: 'big-file.zip',
    uploadedBytes: 5 * 1024 ** 3,
    initiated: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 0.12,
    ...overrides,
  });
}

describe('S3MultipartUploadAbandoned', () => {
  it('exposes correct id and fields', () => {
    const upload = makeUpload();
    expect(upload.id).toBe('upload-abc123');
    expect(upload.bucketName).toBe('my-bucket');
    expect(upload.key).toBe('big-file.zip');
  });

  it('exposes kind and wasteReason', () => {
    expect(makeUpload().kind).toBe('s3-multipart-upload-abandoned');
    expect(makeUpload().wasteReason).toContain('incomplete multipart upload');
  });

  it('costEstimate description references the uploaded size', () => {
    expect(makeUpload().costEstimate.description).toContain('5.00 GB');
  });
});
