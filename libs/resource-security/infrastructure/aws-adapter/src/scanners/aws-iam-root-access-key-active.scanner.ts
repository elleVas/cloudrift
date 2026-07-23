// SPDX-License-Identifier: Apache-2.0
import { IAMClient, GetAccountSummaryCommand } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { IamRootAccessKeyActive, IamRootAccessKeyActivePolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

const IAM_ENDPOINT_REGION = 'us-east-1';

/** Detects whether the account's root user has at least one active access key (CIS AWS Foundations 1.4). `scope: 'global'`. */
export class AwsIamRootAccessKeyActiveScanner implements ResourceSecurityScannerPort {
  readonly kind = 'iam-root-access-key-active' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamRootAccessKeyActivePolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const { SummaryMap } = await client.send(new GetAccountSummaryCommand({}));
      const now = new Date();
      const finding = new IamRootAccessKeyActive({
        accountId: this.accountId,
        accessKeysPresent: SummaryMap?.AccountAccessKeysPresent === 1,
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
