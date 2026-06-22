import {
  S3Client,
  ListBucketsCommand,
  GetBucketLifecycleConfigurationCommand,
  type Bucket,
} from '@aws-sdk/client-s3';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { S3Bucket, S3NoLifecyclePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const METRIC_CONCURRENCY = 5;
const METRIC_LOOKBACK_DAYS = 2;
/** Fraction of the Standard storage cost considered a potential saving by enabling a lifecycle policy (heuristic estimate). */
const ESTIMATED_SAVING_FRACTION = 0.4;

/**
 * Detects S3 buckets with no lifecycle policy configured. Buckets are
 * global: `ListBucketsCommand` filters by `BucketRegion` so each scanned
 * region only sees the buckets that actually belong to it.
 */
export class AwsS3NoLifecycleScanner implements WasteScannerPort {
  readonly kind = 's3-no-lifecycle' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new S3NoLifecyclePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const s3 = new S3Client({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const rawBuckets = await paginate<Bucket>(async (cursor) => {
        const r = await s3.send(
          new ListBucketsCommand({ BucketRegion: region.code, ContinuationToken: cursor }),
        );
        return { items: r.Buckets ?? [], cursor: r.ContinuationToken };
      });

      if (rawBuckets.length === 0) return Result.ok([]);

      const pricePerGb = this.pricing.getS3StandardPricePerGbMonth(region);
      const now = new Date();

      const details = await mapWithConcurrency(rawBuckets, METRIC_CONCURRENCY, async (b) => {
        const name = b.Name!;
        const [hasLifecyclePolicy, sizeBytes] = await Promise.all([
          this.hasLifecycle(s3, name),
          this.sizeBytes(cw, name),
        ]);
        return { name, hasLifecyclePolicy, sizeBytes };
      });

      const buckets = rawBuckets
        .map((b, index) => {
          const { hasLifecyclePolicy, sizeBytes } = details[index];
          const sizeGb = sizeBytes / 1024 ** 3;
          return new S3Bucket({
            bucketName: b.Name!,
            region,
            accountId: this.accountId,
            sizeBytes,
            hasLifecyclePolicy,
            creationDate: b.CreationDate ?? new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +(sizeGb * pricePerGb * ESTIMATED_SAVING_FRACTION).toFixed(4),
          });
        })
        .filter((bucket) => this.policy.evaluate(bucket, now).isWaste);

      return Result.ok(buckets);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err as Error));
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
      if ((err as Error).name === 'NoSuchLifecycleConfiguration') return false;
      throw err;
    }
  }

  private async sizeBytes(cw: CloudWatchClient, bucket: string): Promise<number> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - METRIC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/S3',
        MetricName: 'BucketSizeBytes',
        Dimensions: [
          { Name: 'BucketName', Value: bucket },
          { Name: 'StorageType', Value: 'StandardStorage' },
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Average'],
      }),
    );
    return r.Datapoints?.[0]?.Average ?? 0;
  }
}
