// SPDX-License-Identifier: Apache-2.0
import {
  S3Client,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  type Bucket,
  type MultipartUpload,
  type Part,
} from '@aws-sdk/client-s3';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { S3MultipartUploadAbandoned, S3MultipartUploadAbandonedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');
const BUCKET_CONCURRENCY = 5;
const UPLOAD_CONCURRENCY = 5;

type BucketWithName = Bucket & { Name: string };

interface RawUpload {
  bucket: string;
  key: string;
  uploadId: string;
  initiated: Date;
  sizeBytes: number;
}

/**
 * Detects incomplete S3 multipart uploads (never completed or aborted).
 * Buckets are global: `ListBucketsCommand` filters by `BucketRegion` so each
 * scanned region only sees the buckets that actually belong to it, matching
 * `AwsS3NoLifecycleScanner`.
 */
export class AwsS3MultipartUploadAbandonedScanner implements WasteScannerPort {
  readonly kind = 's3-multipart-upload-abandoned' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new S3MultipartUploadAbandonedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const s3 = new S3Client({
      ...createAwsClientConfig(),
      region: region.code,
      forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
    });
    try {
      const allBuckets = await paginate<Bucket>(async (cursor) => {
        const r = await s3.send(
          new ListBucketsCommand({ BucketRegion: region.code, ContinuationToken: cursor }),
        );
        return { items: r.Buckets ?? [], cursor: r.ContinuationToken };
      });
      const buckets = allBuckets.filter((b): b is BucketWithName => !!b.Name);
      if (buckets.length !== allBuckets.length) {
        logger.debug(`${this.kind}: skipped ${allBuckets.length - buckets.length} entries missing Name`);
      }

      const perBucketUploads = await mapWithConcurrency(buckets, BUCKET_CONCURRENCY, (b) =>
        this.listAbandonedUploads(s3, b.Name),
      );

      const now = new Date();
      const pricePerGb = this.pricing.getPrice(region, 's3-standard');

      const results = perBucketUploads
        .flat()
        .map((u) => {
          const sizeGb = u.sizeBytes / 1024 ** 3;
          return new S3MultipartUploadAbandoned({
            uploadId: u.uploadId,
            region,
            accountId: this.accountId,
            bucketName: u.bucket,
            key: u.key,
            uploadedBytes: u.sizeBytes,
            initiated: u.initiated,
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +(sizeGb * pricePerGb).toFixed(4),
          });
        })
        .filter((upload) => this.policy.evaluate(upload, now).isWaste);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err as Error));
    } finally {
      s3.destroy();
    }
  }

  /** ListMultipartUploads uses a two-token cursor (KeyMarker + UploadIdMarker), unlike the rest of the S3/EC2 APIs — `paginate()`'s single-cursor shape doesn't fit, hence the manual loop. */
  private async listAbandonedUploads(s3: S3Client, bucket: string): Promise<RawUpload[]> {
    const uploads: MultipartUpload[] = [];
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const r = await s3.send(
        new ListMultipartUploadsCommand({ Bucket: bucket, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }),
      );
      uploads.push(...(r.Uploads ?? []));
      keyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
      uploadIdMarker = r.IsTruncated ? r.NextUploadIdMarker : undefined;
    } while (keyMarker !== undefined);

    const validUploads = uploads.filter(
      (u): u is MultipartUpload & { UploadId: string; Key: string } => !!u.UploadId && !!u.Key,
    );
    if (validUploads.length !== uploads.length) {
      logger.debug(
        `${this.kind}: skipped ${uploads.length - validUploads.length} entries missing UploadId/Key in ${bucket}`,
      );
    }

    return mapWithConcurrency(validUploads, UPLOAD_CONCURRENCY, async (u) => ({
      bucket,
      key: u.Key,
      uploadId: u.UploadId,
      initiated: u.Initiated ?? new Date(0),
      sizeBytes: await this.sumPartSizes(s3, bucket, u.Key, u.UploadId),
    }));
  }

  private async sumPartSizes(s3: S3Client, bucket: string, key: string, uploadId: string): Promise<number> {
    const parts = await paginate<Part>(async (cursor) => {
      const r = await s3.send(
        new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: cursor }),
      );
      return { items: r.Parts ?? [], cursor: r.IsTruncated ? r.NextPartNumberMarker : undefined };
    });
    return parts.reduce((sum, p) => sum + (p.Size ?? 0), 0);
  }
}
