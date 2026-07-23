// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand, ListAccessKeysCommand, type User, type AccessKeyMetadata } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { IamAccessKeyRotationOverdue, IamAccessKeyRotationOverduePolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const IAM_ENDPOINT_REGION = 'us-east-1';
/** Per-user `ListAccessKeysCommand` calls in flight at once. */
const USER_CHECK_CONCURRENCY = 8;

type UserWithName = User & { UserName: string };
type KeyWithId = AccessKeyMetadata & { AccessKeyId: string; UserName: string; CreateDate: Date };

/** Detects active IAM access keys older than the rotation policy (CIS AWS Foundations 1.14, default 90d). `scope: 'global'`. */
export class AwsIamAccessKeyRotationOverdueScanner implements ResourceSecurityScannerPort {
  readonly kind = 'iam-access-key-rotation-overdue' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamAccessKeyRotationOverduePolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const rawUsers = await paginate<User>(async (cursor) => {
        const r = await client.send(new ListUsersCommand({ Marker: cursor }));
        return { items: r.Users ?? [], cursor: r.Marker };
      });
      const validUsers = rawUsers.filter((u): u is UserWithName => !!u.UserName);

      const keysByUser = await mapWithConcurrency(validUsers, USER_CHECK_CONCURRENCY, async (user) => {
        const { AccessKeyMetadata: keys } = await client.send(new ListAccessKeysCommand({ UserName: user.UserName }));
        return (keys ?? []).filter(
          (k): k is KeyWithId => !!k.AccessKeyId && !!k.UserName && !!k.CreateDate && k.Status === 'Active',
        );
      });

      const now = new Date();
      const results = keysByUser
        .flat()
        .map(
          (key) =>
            new IamAccessKeyRotationOverdue({
              accessKeyId: key.AccessKeyId,
              userName: key.UserName,
              accountId: this.accountId,
              createdAt: key.CreateDate,
              detectedAt: now,
              tags: {},
            }),
        )
        .filter((finding) => this.policy.evaluate(finding, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
