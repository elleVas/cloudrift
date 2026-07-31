// SPDX-License-Identifier: Apache-2.0
import { S3ControlClient, GetPublicAccessBlockCommand } from '@aws-sdk/client-s3-control';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { S3AccountPublicAccessBlockDisabled, S3AccountPublicAccessBlockDisabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, createAwsClientConfig } from 'shared-aws-infra-utils';

/**
 * Detects an account where S3 Block Public Access isn't fully enabled at
 * the account level (all four settings true) — the safety net that would
 * stop any bucket, including a newly created one, from becoming public.
 * `scope: 'global'` — this is one account-wide setting, not per-region.
 */
export class AwsS3AccountPublicAccessBlockDisabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 's3-account-public-access-block-disabled' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new S3AccountPublicAccessBlockDisabledPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new S3ControlClient({ ...createAwsClientConfig(this.credentials), region: 'us-east-1' });
    try {
      let fullyBlocked = false;
      try {
        const { PublicAccessBlockConfiguration: cfg } = await client.send(new GetPublicAccessBlockCommand({ AccountId: this.accountId }));
        fullyBlocked = !!(cfg?.BlockPublicAcls && cfg?.IgnorePublicAcls && cfg?.BlockPublicPolicy && cfg?.RestrictPublicBuckets);
      } catch (err) {
        if (!(err instanceof Error) || err.name !== 'NoSuchPublicAccessBlockConfiguration') throw err;
      }
      if (fullyBlocked) return Result.ok([]);

      const now = new Date();
      const finding = new S3AccountPublicAccessBlockDisabled({ accountId: this.accountId, detectedAt: now, tags: {} });
      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('S3Control', err));
    } finally {
      client.destroy();
    }
  }
}
