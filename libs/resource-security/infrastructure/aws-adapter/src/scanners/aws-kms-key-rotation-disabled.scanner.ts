// SPDX-License-Identifier: Apache-2.0
import { KMSClient, ListKeysCommand, DescribeKeyCommand, GetKeyRotationStatusCommand, type KeyListEntry } from '@aws-sdk/client-kms';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { KmsKeyRotationDisabled, KmsKeyRotationDisabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

type KeyWithId = KeyListEntry & { KeyId: string };

/** Per-key `DescribeKey`/`GetKeyRotationStatus` calls in flight at once. */
const KEY_CHECK_CONCURRENCY = 8;

/**
 * Detects customer-managed symmetric KMS keys with automatic rotation
 * disabled (CIS AWS Foundations 3.8). AWS-managed keys and non-symmetric-
 * encryption keys (asymmetric, HMAC) are skipped — `GetKeyRotationStatus`
 * doesn't apply to them and AWS manages their rotation itself.
 */
export class AwsKmsKeyRotationDisabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'kms-key-rotation-disabled' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new KmsKeyRotationDisabledPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new KMSClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawKeys = await paginate<KeyListEntry>(async (cursor) => {
        const r = await client.send(new ListKeysCommand({ Marker: cursor }));
        return { items: r.Keys ?? [], cursor: r.NextMarker };
      });
      const validKeys = rawKeys.filter((k): k is KeyWithId => !!k.KeyId);
      const now = new Date();

      const candidates = await mapWithConcurrency(validKeys, KEY_CHECK_CONCURRENCY, async (key) => {
        try {
          const { KeyMetadata } = await client.send(new DescribeKeyCommand({ KeyId: key.KeyId }));
          if (KeyMetadata?.KeyManager !== 'CUSTOMER' || KeyMetadata?.KeySpec !== 'SYMMETRIC_DEFAULT') return undefined;

          const { KeyRotationEnabled } = await client.send(new GetKeyRotationStatusCommand({ KeyId: key.KeyId }));
          if (KeyRotationEnabled === true) return undefined;

          return new KmsKeyRotationDisabled({ keyId: key.KeyId, region, accountId: this.accountId, detectedAt: now, tags: {} });
        } catch (err) {
          logger.debug('kms-key-rotation-disabled: skipping key after error', { keyId: key.KeyId, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is KmsKeyRotationDisabled => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('KMS', err));
    } finally {
      client.destroy();
    }
  }
}
