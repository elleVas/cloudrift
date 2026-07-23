// SPDX-License-Identifier: Apache-2.0
import { IAMClient, GetAccountSummaryCommand } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { IamRootMfaDisabled, IamRootMfaDisabledPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

/** IAM has a single global endpoint — always sign against this region, never the one `scan()` receives. */
const IAM_ENDPOINT_REGION = 'us-east-1';

/**
 * Detects whether the account's root user has no MFA device enrolled
 * (CIS AWS Foundations 1.5/1.6). `scope: 'global'` — IAM has no per-region
 * data.
 */
export class AwsIamRootMfaDisabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'iam-root-mfa-disabled' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamRootMfaDisabledPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const { SummaryMap } = await client.send(new GetAccountSummaryCommand({}));
      const now = new Date();
      const finding = new IamRootMfaDisabled({
        accountId: this.accountId,
        mfaEnabled: SummaryMap?.AccountMFAEnabled === 1,
        detectedAt: now,
        tags: {},
      });

      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
