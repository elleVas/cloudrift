// SPDX-License-Identifier: Apache-2.0
import { S3Client, ListBucketsCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { S3BucketVersioningDisabled, S3BucketVersioningDisabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-bucket `GetBucketVersioning` calls in flight at once. */
const BUCKET_CHECK_CONCURRENCY = 8;

/**
 * Detects S3 buckets with versioning disabled, or versioning enabled but
 * MFA Delete not required (CIS AWS Foundations 2.1.3/2.1.4). `scope:
 * 'global'` — bucket names are account-wide, `ListBuckets` is called once.
 */
export class AwsS3BucketVersioningDisabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 's3-bucket-versioning-disabled' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new S3BucketVersioningDisabledPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new S3Client({ ...createAwsClientConfig(this.credentials), region: 'us-east-1' });
    try {
      const { Buckets } = await client.send(new ListBucketsCommand({}));
      const bucketNames = (Buckets ?? []).map((b) => b.Name).filter((n): n is string => !!n);
      const now = new Date();

      const candidates = await mapWithConcurrency(bucketNames, BUCKET_CHECK_CONCURRENCY, async (bucketName) => {
        try {
          const { Status, MFADelete } = await client.send(new GetBucketVersioningCommand({ Bucket: bucketName }));
          if (Status !== 'Enabled') {
            return new S3BucketVersioningDisabled({ bucketName, accountId: this.accountId, issue: 'versioning-disabled', detectedAt: now, tags: {} });
          }
          if (MFADelete !== 'Enabled') {
            return new S3BucketVersioningDisabled({ bucketName, accountId: this.accountId, issue: 'mfa-delete-disabled', detectedAt: now, tags: {} });
          }
          return undefined;
        } catch (err) {
          logger.debug('s3-bucket-versioning-disabled: skipping bucket after error', { bucketName, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is S3BucketVersioningDisabled => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err));
    } finally {
      client.destroy();
    }
  }
}
