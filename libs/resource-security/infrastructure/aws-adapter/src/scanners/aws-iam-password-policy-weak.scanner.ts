// SPDX-License-Identifier: Apache-2.0
import { IAMClient, GetAccountPasswordPolicyCommand } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { IamPasswordPolicyWeak, IamPasswordPolicyWeakPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

const IAM_ENDPOINT_REGION = 'us-east-1';

/** AWS's own name for "no password policy configured at all". */
const NO_POLICY_ERROR_NAME = 'NoSuchEntityException';

/** Detects a missing or CIS-baseline-violating account password policy (CIS AWS Foundations 1.8/1.9). `scope: 'global'`. */
export class AwsIamPasswordPolicyWeakScanner implements ResourceSecurityScannerPort {
  readonly kind = 'iam-password-policy-weak' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamPasswordPolicyWeakPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const now = new Date();
      let finding: IamPasswordPolicyWeak;
      try {
        const { PasswordPolicy: p } = await client.send(new GetAccountPasswordPolicyCommand({}));
        finding = new IamPasswordPolicyWeak({
          accountId: this.accountId,
          exists: true,
          minimumPasswordLength: p?.MinimumPasswordLength,
          requireSymbols: p?.RequireSymbols,
          requireNumbers: p?.RequireNumbers,
          requireUppercaseCharacters: p?.RequireUppercaseCharacters,
          requireLowercaseCharacters: p?.RequireLowercaseCharacters,
          maxPasswordAge: p?.MaxPasswordAge,
          passwordReusePrevention: p?.PasswordReusePrevention,
          detectedAt: now,
          tags: {},
        });
      } catch (err) {
        if ((err as Error).name !== NO_POLICY_ERROR_NAME) throw err;
        finding = new IamPasswordPolicyWeak({ accountId: this.accountId, exists: false, detectedAt: now, tags: {} });
      }

      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
