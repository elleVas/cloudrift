// SPDX-License-Identifier: Apache-2.0
import { GuardDutyClient, ListDetectorsCommand } from '@aws-sdk/client-guardduty';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { GuarddutyNotEnabled, GuarddutyNotEnabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, createAwsClientConfig } from 'shared-aws-infra-utils';

/** Detects regions with no GuardDuty detector configured. `scope: 'regional'` — GuardDuty detectors are per-region resources. */
export class AwsGuarddutyNotEnabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'guardduty-not-enabled' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new GuarddutyNotEnabledPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new GuardDutyClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const { DetectorIds } = await client.send(new ListDetectorsCommand({}));
      if ((DetectorIds ?? []).length > 0) return Result.ok([]);

      const now = new Date();
      const finding = new GuarddutyNotEnabled({ region, accountId: this.accountId, detectedAt: now, tags: {} });
      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('GuardDuty', err));
    } finally {
      client.destroy();
    }
  }
}
