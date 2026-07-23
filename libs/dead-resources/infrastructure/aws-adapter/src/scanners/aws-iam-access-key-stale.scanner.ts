// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand, ListAccessKeysCommand, type User } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { IamAccessKeyStale, IamAccessKeyStalePolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

/** IAM has a single global endpoint — always sign against this region, never the one `scan()` receives (ADR-0078). */
const IAM_ENDPOINT_REGION = 'us-east-1';

/** Bounds the per-user ListAccessKeys fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const ACCESS_KEY_LOOKUP_CONCURRENCY = 5;

type UserWithName = User & { UserName: string };

/**
 * Detects **active** IAM access keys not rotated within the policy's age
 * threshold. Only `Active` keys are considered — an `Inactive` key has
 * already been deliberately disabled by someone, so it's not the same
 * rotation risk. `scope: 'global'` — IAM has no per-region data, see
 * `DeadResourceScannerPort` and ADR-0078.
 */
export class AwsIamAccessKeyStaleScanner implements DeadResourceScannerPort {
  readonly kind = 'iam-access-key-stale' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamAccessKeyStalePolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const rawUsers = await paginate<User>(async (cursor) => {
        const r = await client.send(new ListUsersCommand({ Marker: cursor }));
        return { items: r.Users ?? [], cursor: r.Marker };
      });
      const validUsers = rawUsers.filter((u): u is UserWithName => !!u.UserName);

      const now = new Date();
      const perUserKeys = await mapWithConcurrency(validUsers, ACCESS_KEY_LOOKUP_CONCURRENCY, async (user) => {
        // AWS caps a user at 2 access keys — one unpaginated call always returns the complete list.
        const r = await client.send(new ListAccessKeysCommand({ UserName: user.UserName }));
        return (r.AccessKeyMetadata ?? [])
          .filter((k) => !!k.AccessKeyId && !!k.CreateDate && k.Status === 'Active')
          .map(
            (k) =>
              new IamAccessKeyStale({
                accessKeyId: k.AccessKeyId as string,
                userName: user.UserName,
                status: 'Active',
                accountId: this.accountId,
                createdAt: k.CreateDate as Date,
                detectedAt: now,
                tags: {},
              }),
          );
      });

      const results = perUserKeys.flat().filter((key) => this.policy.evaluate(key, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
