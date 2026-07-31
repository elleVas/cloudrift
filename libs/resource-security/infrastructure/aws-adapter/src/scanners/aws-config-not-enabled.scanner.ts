// SPDX-License-Identifier: Apache-2.0
import { ConfigServiceClient, DescribeConfigurationRecorderStatusCommand } from '@aws-sdk/client-config-service';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { ConfigNotEnabled, ConfigNotEnabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, createAwsClientConfig } from 'shared-aws-infra-utils';

/** Detects regions with no AWS Config recorder actively recording. `scope: 'regional'`. */
export class AwsConfigNotEnabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'config-not-enabled' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new ConfigNotEnabledPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new ConfigServiceClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const { ConfigurationRecordersStatus } = await client.send(new DescribeConfigurationRecorderStatusCommand({}));
      const isRecording = (ConfigurationRecordersStatus ?? []).some((s) => s.recording === true);
      if (isRecording) return Result.ok([]);

      const now = new Date();
      const finding = new ConfigNotEnabled({ region, accountId: this.accountId, detectedAt: now, tags: {} });
      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Config', err));
    } finally {
      client.destroy();
    }
  }
}
