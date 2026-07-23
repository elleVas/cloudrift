// SPDX-License-Identifier: Apache-2.0
import {
  IAMClient,
  ListUsersCommand,
  ListAccessKeysCommand,
  GetAccessKeyLastUsedCommand,
  type User,
} from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { IamUserInactive, IamUserInactivePolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

/** IAM has a single global endpoint — always sign against this region, never the one `scan()` receives (ADR-0078). */
const IAM_ENDPOINT_REGION = 'us-east-1';

/** Bounds ListAccessKeys/GetAccessKeyLastUsed fan-out, same reasoning as the CloudWatch scanners' metric fan-out. */
const USER_ACTIVITY_CONCURRENCY = 5;

type UserWithId = User & { UserId: string; UserName: string; Arn: string; CreateDate: Date };

async function resolveLastActivity(client: IAMClient, userName: string, passwordLastUsed: Date | undefined): Promise<Date | undefined> {
  // AWS caps a user at 2 active access keys — one unpaginated call always
  // returns the complete list, no need for paginate() here.
  const keysResponse = await client.send(new ListAccessKeysCommand({ UserName: userName }));
  const keyIds = (keysResponse.AccessKeyMetadata ?? []).map((k) => k.AccessKeyId).filter((id): id is string => !!id);

  const keyLastUsedDates = await Promise.all(
    keyIds.map(async (accessKeyId) => {
      const r = await client.send(new GetAccessKeyLastUsedCommand({ AccessKeyId: accessKeyId }));
      return r.AccessKeyLastUsed?.LastUsedDate;
    }),
  );

  const candidates = [passwordLastUsed, ...keyLastUsedDates].filter((d): d is Date => d !== undefined);
  if (candidates.length === 0) return undefined;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Detects IAM users with no console login or access-key usage within the
 * policy's window (or ever). `scope: 'global'` — IAM has no per-region data,
 * see `DeadResourceScannerPort` and ADR-0078.
 */
export class AwsIamUserInactiveScanner implements DeadResourceScannerPort {
  readonly kind = 'iam-user-inactive' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamUserInactivePolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const rawUsers = await paginate<User>(async (cursor) => {
        const r = await client.send(new ListUsersCommand({ Marker: cursor }));
        return { items: r.Users ?? [], cursor: r.Marker };
      });

      const validUsers = rawUsers.filter(
        (u): u is UserWithId => !!u.UserId && !!u.UserName && !!u.Arn && !!u.CreateDate,
      );

      const now = new Date();
      const withActivity = await mapWithConcurrency(validUsers, USER_ACTIVITY_CONCURRENCY, async (user) => {
        const lastActivityAt = await resolveLastActivity(client, user.UserName, user.PasswordLastUsed);
        return new IamUserInactive({
          userId: user.UserId,
          userName: user.UserName,
          arn: user.Arn,
          accountId: this.accountId,
          createdAt: user.CreateDate,
          lastActivityAt,
          detectedAt: now,
          tags: Object.fromEntries((user.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
        });
      });

      const results = withActivity.filter((u) => this.policy.evaluate(u, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
