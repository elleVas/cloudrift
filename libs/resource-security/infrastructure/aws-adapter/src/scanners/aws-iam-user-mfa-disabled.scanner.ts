// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand, ListMFADevicesCommand, type User } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { IamUserMfaDisabled, IamUserMfaDisabledPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const IAM_ENDPOINT_REGION = 'us-east-1';
/** Per-user `ListMFADevicesCommand` calls in flight at once. */
const USER_CHECK_CONCURRENCY = 8;

type UserWithName = User & { UserName: string; Arn: string; CreateDate: Date };

/** Detects IAM users with no MFA device registered (CIS AWS Foundations 1.10). `scope: 'global'`. */
export class AwsIamUserMfaDisabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'iam-user-mfa-disabled' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamUserMfaDisabledPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const rawUsers = await paginate<User>(async (cursor) => {
        const r = await client.send(new ListUsersCommand({ Marker: cursor }));
        return { items: r.Users ?? [], cursor: r.Marker };
      });

      const validUsers = rawUsers.filter((u): u is UserWithName => !!u.UserName && !!u.Arn && !!u.CreateDate);
      const now = new Date();

      const candidates = await mapWithConcurrency(validUsers, USER_CHECK_CONCURRENCY, async (user) => {
        const { MFADevices } = await client.send(new ListMFADevicesCommand({ UserName: user.UserName }));
        if ((MFADevices ?? []).length > 0) return undefined;
        return new IamUserMfaDisabled({
          userName: user.UserName,
          arn: user.Arn,
          accountId: this.accountId,
          createdAt: user.CreateDate,
          detectedAt: now,
          tags: Object.fromEntries((user.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
        });
      });

      const results = candidates
        .filter((c): c is IamUserMfaDisabled => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
