// SPDX-License-Identifier: Apache-2.0
import {
  S3Client,
  ListBucketsCommand,
  GetPublicAccessBlockCommand,
  GetBucketPolicyStatusCommand,
  GetBucketAclCommand,
} from '@aws-sdk/client-s3';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { S3BucketPublic, S3BucketPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');
/** Per-bucket check calls in flight at once. */
const BUCKET_CHECK_CONCURRENCY = 8;
const PUBLIC_GROUP_URIS = new Set([
  'http://acs.amazonaws.com/groups/global/AllUsers',
  'http://acs.amazonaws.com/groups/global/AuthenticatedUsers',
]);

async function findPublicVia(client: S3Client, bucketName: string): Promise<string[]> {
  let fullyBlocked = false;
  try {
    const { PublicAccessBlockConfiguration: cfg } = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucketName }));
    fullyBlocked = !!(cfg?.BlockPublicAcls && cfg?.IgnorePublicAcls && cfg?.BlockPublicPolicy && cfg?.RestrictPublicBuckets);
  } catch (err) {
    if ((err as Error).name !== 'NoSuchPublicAccessBlockConfiguration') throw err;
  }
  // S3 Block Public Access, when fully enabled, overrides both ACLs and bucket policies account/bucket-wide.
  if (fullyBlocked) return [];

  const reasons: string[] = [];

  try {
    const { PolicyStatus } = await client.send(new GetBucketPolicyStatusCommand({ Bucket: bucketName }));
    if (PolicyStatus?.IsPublic) reasons.push('bucket policy allows public access');
  } catch (err) {
    if ((err as Error).name !== 'NoSuchBucketPolicy') throw err;
  }

  const { Grants } = await client.send(new GetBucketAclCommand({ Bucket: bucketName }));
  const hasPublicGrant = (Grants ?? []).some((g) => g.Grantee?.Type === 'Group' && PUBLIC_GROUP_URIS.has(g.Grantee.URI ?? ''));
  if (hasPublicGrant) reasons.push('bucket ACL grants public access');

  return reasons;
}

/**
 * Detects S3 buckets reachable by the internet via their ACL and/or bucket
 * policy (CIS AWS Foundations 2.1.5). `scope: 'global'` — bucket names are
 * account-wide, `ListBuckets` is called once, not per region.
 */
export class AwsS3BucketPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 's3-bucket-public' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new S3BucketPublicPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new S3Client({ ...createAwsClientConfig(), region: 'us-east-1' });
    try {
      const { Buckets } = await client.send(new ListBucketsCommand({}));
      const bucketNames = (Buckets ?? []).map((b) => b.Name).filter((n): n is string => !!n);
      const now = new Date();

      const candidates = await mapWithConcurrency(bucketNames, BUCKET_CHECK_CONCURRENCY, async (bucketName) => {
        try {
          const publicVia = await findPublicVia(client, bucketName);
          if (publicVia.length === 0) return undefined;
          return new S3BucketPublic({ bucketName, accountId: this.accountId, publicVia, detectedAt: now, tags: {} });
        } catch (err) {
          // A single unreadable bucket (e.g. a bucket policy denying this principal) shouldn't fail the whole scan.
          logger.debug('s3-bucket-public: skipping bucket after error', { bucketName, error: (err as Error).message });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is S3BucketPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3', err as Error));
    } finally {
      client.destroy();
    }
  }
}
