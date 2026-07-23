// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand, ListObjectsV2Command, type Bucket } from '@aws-sdk/client-s3';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { S3BucketEmpty, S3BucketEmptyPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

/** `ListBuckets` is account-wide, not regional — any endpoint region works as a starting point given `followRegionRedirects`. */
const S3_ENDPOINT_REGION = 'us-east-1';

/** Bounds the per-bucket `ListObjectsV2` fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const BUCKET_INSPECTION_CONCURRENCY = 5;

type BucketWithId = Bucket & { Name: string; CreationDate: Date };

/**
 * Detects S3 buckets with zero objects. `scope: 'global'` — `ListBuckets`
 * is a single account-wide call regardless of region, see
 * `DeadResourceScannerPort` and ADR-0078. `followRegionRedirects: true`
 * lets one client transparently retry `ListObjectsV2` against each
 * bucket's real region instead of requiring a `GetBucketLocation` call
 * per bucket first. A bucket the caller can't `ListObjectsV2` on (e.g.
 * access denied by a bucket policy) is skipped, not flagged — this
 * scanner can only report what it could actually inspect.
 */
export class AwsS3BucketEmptyScanner implements DeadResourceScannerPort {
  readonly kind = 's3-bucket-empty' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new S3BucketEmptyPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new S3Client({
      ...createAwsClientConfig(),
      region: S3_ENDPOINT_REGION,
      followRegionRedirects: true,
    });
    try {
      const response = await client.send(new ListBucketsCommand({}));
      const validBuckets = (response.Buckets ?? []).filter(
        (b): b is BucketWithId => !!b.Name && !!b.CreationDate,
      );

      const now = new Date();
      const candidates = await mapWithConcurrency(validBuckets, BUCKET_INSPECTION_CONCURRENCY, async (bucket) => {
        try {
          const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket.Name, MaxKeys: 1 }));
          if ((objects.KeyCount ?? 0) > 0) return undefined;
          return new S3BucketEmpty({
            bucketName: bucket.Name,
            accountId: this.accountId,
            createdAt: bucket.CreationDate,
            detectedAt: now,
            tags: {},
          });
        } catch (err) {
          logger.debug(`s3-bucket-empty: skipped ${bucket.Name}, could not list objects`, { error: (err as Error).message });
          return undefined;
        }
      });

      const results = candidates
        .filter((b): b is S3BucketEmpty => b !== undefined)
        .filter((b) => this.policy.evaluate(b, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err as Error));
    } finally {
      client.destroy();
    }
  }
}
