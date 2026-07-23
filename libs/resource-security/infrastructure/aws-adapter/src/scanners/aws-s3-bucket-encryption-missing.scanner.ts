// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand, GetBucketEncryptionCommand } from '@aws-sdk/client-s3';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { S3BucketEncryptionMissing, S3BucketEncryptionMissingPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');
/** Per-bucket `GetBucketEncryption` calls in flight at once. */
const BUCKET_CHECK_CONCURRENCY = 8;
const NO_ENCRYPTION_ERROR_NAME = 'ServerSideEncryptionConfigurationNotFoundError';

/**
 * Detects S3 buckets with no default server-side encryption configured
 * (CIS AWS Foundations 2.1.1). `scope: 'global'` — bucket names are
 * account-wide, `ListBuckets` is called once, not per region.
 */
export class AwsS3BucketEncryptionMissingScanner implements ResourceSecurityScannerPort {
  readonly kind = 's3-bucket-encryption-missing' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new S3BucketEncryptionMissingPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new S3Client({ ...createAwsClientConfig(), region: 'us-east-1' });
    try {
      const { Buckets } = await client.send(new ListBucketsCommand({}));
      const bucketNames = (Buckets ?? []).map((b) => b.Name).filter((n): n is string => !!n);
      const now = new Date();

      const candidates = await mapWithConcurrency(bucketNames, BUCKET_CHECK_CONCURRENCY, async (bucketName) => {
        try {
          await client.send(new GetBucketEncryptionCommand({ Bucket: bucketName }));
          return undefined; // encryption configuration exists
        } catch (err) {
          if ((err as Error).name !== NO_ENCRYPTION_ERROR_NAME) {
            logger.debug('s3-bucket-encryption-missing: skipping bucket after error', { bucketName, error: (err as Error).message });
            return undefined;
          }
          return new S3BucketEncryptionMissing({ bucketName, accountId: this.accountId, detectedAt: now, tags: {} });
        }
      });

      const results = candidates
        .filter((c): c is S3BucketEncryptionMissing => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err as Error));
    } finally {
      client.destroy();
    }
  }
}
