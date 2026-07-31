// SPDX-License-Identifier: Apache-2.0
import { SecurityHubClient, DescribeHubCommand } from '@aws-sdk/client-securityhub';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { SecurityHubNotEnabled, SecurityHubNotEnabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, createAwsClientConfig } from 'shared-aws-infra-utils';

/**
 * Detects regions where Security Hub isn't enabled. `DescribeHub` fails
 * with `InvalidAccessException` when the account has never enabled it in
 * that region — the only signal AWS exposes for "not enabled" here.
 * `scope: 'regional'`.
 */
export class AwsSecurityHubNotEnabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'security-hub-not-enabled' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new SecurityHubNotEnabledPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new SecurityHubClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      let enabled = true;
      try {
        await client.send(new DescribeHubCommand({}));
      } catch (err) {
        if (err instanceof Error && err.name === 'InvalidAccessException') {
          enabled = false;
        } else {
          throw err;
        }
      }
      if (enabled) return Result.ok([]);

      const now = new Date();
      const finding = new SecurityHubNotEnabled({ region, accountId: this.accountId, detectedAt: now, tags: {} });
      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SecurityHub', err));
    } finally {
      client.destroy();
    }
  }
}
