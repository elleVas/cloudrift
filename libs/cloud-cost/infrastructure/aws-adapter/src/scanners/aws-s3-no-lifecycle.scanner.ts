// SPDX-License-Identifier: Apache-2.0
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLifecycleConfigurationCommand,
  type Bucket,
} from '@aws-sdk/client-s3';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { S3Bucket, S3NoLifecyclePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';
import { avgMetric } from '../utils/cloudwatch-metrics';

const logger = createLogger('cloudrift:scanner');
const METRIC_CONCURRENCY = 5;
const METRIC_LOOKBACK_DAYS = 2;

type BucketWithName = Bucket & { Name: string };

/**
 * Detects S3 buckets with no lifecycle policy configured. Buckets are
 * global: `ListBucketsCommand` filters by `BucketRegion` so each scanned
 * region only sees the buckets that actually belong to it.
 */
export class AwsS3NoLifecycleScanner implements WasteScannerPort {
  readonly kind = 's3-no-lifecycle' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new S3NoLifecyclePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const s3 = new S3Client({
      ...createAwsClientConfig(this.credentials),
      region: region.code,
      forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
    });
    const cw = new CloudWatchClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const allBuckets = await paginate<Bucket>(async (cursor) => {
        const r = await s3.send(
          new ListBucketsCommand({ BucketRegion: region.code, ContinuationToken: cursor }),
        );
        return { items: r.Buckets ?? [], cursor: r.ContinuationToken };
      });
      const rawBuckets = allBuckets.filter((b): b is BucketWithName => !!b.Name);
      if (rawBuckets.length !== allBuckets.length) {
        logger.debug(`${this.kind}: skipped ${allBuckets.length - rawBuckets.length} entries missing Name`);
      }

      if (rawBuckets.length === 0) return Result.ok([]);

      const now = new Date();

      const details = await mapWithConcurrency(rawBuckets, METRIC_CONCURRENCY, async (b) => {
        const name = b.Name;
        const [hasLifecyclePolicy, sizeBytes] = await Promise.all([
          this.hasLifecycle(s3, name),
          this.sizeBytes(cw, name),
        ]);
        return { name, hasLifecyclePolicy, sizeBytes };
      });

      const buckets = rawBuckets
        .map((b, index) => {
          const { hasLifecyclePolicy, sizeBytes } = details[index];
          const props = {
            bucketName: b.Name,
            region,
            accountId: this.accountId,
            sizeBytes,
            hasLifecyclePolicy,
            creationDate: b.CreationDate ?? new Date(0),
            detectedAt: now,
            tags: {},
            // No dollar estimate: the saving depends on the age distribution of
            // objects inside the bucket, which we don't have (see S3Bucket entity
            // doc). This is a hygiene flag, not a costed finding — get the real
            // number from S3 Storage Lens / Storage Class Analysis if you need one.
            monthlyCostUsd: 0,
          };
          const verdict = this.policy.evaluate(new S3Bucket({ ...props, wasteReason: '' }), now);
          return verdict.isWaste ? new S3Bucket({ ...props, wasteReason: verdict.reason }) : null;
        })
        .filter((bucket): bucket is S3Bucket => bucket !== null);

      return Result.ok(buckets);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err));
    } finally {
      s3.destroy();
      cw.destroy();
    }
  }

  private async hasLifecycle(client: S3Client, bucket: string): Promise<boolean> {
    try {
      await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'NoSuchLifecycleConfiguration') return false;
      throw err;
    }
  }

  private async sizeBytes(cw: CloudWatchClient, bucket: string): Promise<number> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - METRIC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // Period is a fixed 1 day, not the whole lookback (unlike every other
    // CloudWatch scanner): S3 only publishes BucketSizeBytes once/day, so a
    // wider period would just return the same single datapoint.
    return avgMetric(
      cw,
      'AWS/S3',
      'BucketSizeBytes',
      [
        { Name: 'BucketName', Value: bucket },
        { Name: 'StorageType', Value: 'StandardStorage' },
      ],
      { startTime, endTime, periodSeconds: 86400 },
    );
  }
}
