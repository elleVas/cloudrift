// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListRolesCommand, type Role } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { IamRoleUnused, IamRoleUnusedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

/** IAM has a single global endpoint — always sign against this region, never the one `scan()` receives (ADR-0078). */
const IAM_ENDPOINT_REGION = 'us-east-1';

/** AWS-managed, account doesn't control their lifecycle — excluding them here mirrors `ListPoliciesCommand({ Scope: 'Local' })`'s server-side filter for `iam-policy-unattached`. */
const SERVICE_LINKED_ROLE_PATH_PREFIX = '/aws-service-role/';

type RoleWithId = Role & { RoleId: string; RoleName: string; Arn: string; CreateDate: Date };

/**
 * Detects IAM roles never assumed, or not assumed within the policy's
 * inactivity window. `scope: 'global'` — IAM has no per-region data, see
 * `DeadResourceScannerPort` and ADR-0078.
 */
export class AwsIamRoleUnusedScanner implements DeadResourceScannerPort {
  readonly kind = 'iam-role-unused' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamRoleUnusedPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const rawRoles = await paginate<Role>(async (cursor) => {
        const r = await client.send(new ListRolesCommand({ Marker: cursor }));
        return { items: r.Roles ?? [], cursor: r.Marker };
      });

      const validRoles = rawRoles.filter(
        (role): role is RoleWithId =>
          !!role.RoleId && !!role.RoleName && !!role.Arn && !!role.CreateDate && !(role.Path ?? '').startsWith(SERVICE_LINKED_ROLE_PATH_PREFIX),
      );

      const now = new Date();
      const results = validRoles
        .map(
          (role) =>
            new IamRoleUnused({
              roleId: role.RoleId,
              roleName: role.RoleName,
              arn: role.Arn,
              accountId: this.accountId,
              createdAt: role.CreateDate,
              lastUsedAt: role.RoleLastUsed?.LastUsedDate,
              detectedAt: now,
              tags: Object.fromEntries((role.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((role) => this.policy.evaluate(role, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
