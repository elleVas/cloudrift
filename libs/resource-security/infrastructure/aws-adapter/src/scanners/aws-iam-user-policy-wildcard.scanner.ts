// SPDX-License-Identifier: Apache-2.0
import {
  IAMClient,
  ListUsersCommand,
  ListAttachedUserPoliciesCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  ListUserPoliciesCommand,
  GetUserPolicyCommand,
  type User,
} from '@aws-sdk/client-iam';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { IamUserPolicyWildcard, IamUserPolicyWildcardPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig, parsePolicyStatements, statementValues } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
const IAM_ENDPOINT_REGION = 'us-east-1';
/** Per-user policy-inspection calls in flight at once. */
const USER_CHECK_CONCURRENCY = 5;

type UserWithName = User & { UserName: string; Arn: string };

function isWildcardAdminDocument(policyJson: string | undefined): boolean {
  const statements = parsePolicyStatements(policyJson);
  return statements.some((s) => s.Effect === 'Allow' && statementValues(s.Action).includes('*') && statementValues(s.Resource).includes('*'));
}

/**
 * Finds the name of the first policy (managed, then inline) attached
 * directly to `userName` that grants `Action: "*"` on `Resource: "*"`.
 * Stops at the first match — one finding per user is enough to act on.
 */
async function findWildcardAdminPolicyName(client: IAMClient, userName: string): Promise<string | undefined> {
  const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: userName }));
  for (const attached of AttachedPolicies ?? []) {
    if (!attached.PolicyArn || !attached.PolicyName) continue;
    const { Policy } = await client.send(new GetPolicyCommand({ PolicyArn: attached.PolicyArn }));
    if (!Policy?.DefaultVersionId) continue;
    const { PolicyVersion } = await client.send(new GetPolicyVersionCommand({ PolicyArn: attached.PolicyArn, VersionId: Policy.DefaultVersionId }));
    if (isWildcardAdminDocument(PolicyVersion?.Document ? decodeURIComponent(PolicyVersion.Document) : undefined)) {
      return attached.PolicyName;
    }
  }

  const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: userName }));
  for (const policyName of PolicyNames ?? []) {
    const { PolicyDocument } = await client.send(new GetUserPolicyCommand({ UserName: userName, PolicyName: policyName }));
    if (isWildcardAdminDocument(PolicyDocument ? decodeURIComponent(PolicyDocument) : undefined)) {
      return policyName;
    }
  }

  return undefined;
}

/** Detects IAM users with a wildcard-admin policy (`Action: "*"`, `Resource: "*"`) attached directly, inline or managed. `scope: 'global'`. */
export class AwsIamUserPolicyWildcardScanner implements ResourceSecurityScannerPort {
  readonly kind = 'iam-user-policy-wildcard' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new IamUserPolicyWildcardPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(this.credentials), region: IAM_ENDPOINT_REGION });
    try {
      const rawUsers = await paginate<User>(async (cursor) => {
        const r = await client.send(new ListUsersCommand({ Marker: cursor }));
        return { items: r.Users ?? [], cursor: r.Marker };
      });
      const validUsers = rawUsers.filter((u): u is UserWithName => !!u.UserName && !!u.Arn);
      const now = new Date();

      const candidates = await mapWithConcurrency(validUsers, USER_CHECK_CONCURRENCY, async (user) => {
        try {
          const policyName = await findWildcardAdminPolicyName(client, user.UserName);
          if (!policyName) return undefined;
          return new IamUserPolicyWildcard({ userName: user.UserName, arn: user.Arn, accountId: this.accountId, policyName, detectedAt: now, tags: {} });
        } catch (err) {
          logger.debug('iam-user-policy-wildcard: skipping user after error', { userName: user.UserName, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is IamUserPolicyWildcard => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err));
    } finally {
      client.destroy();
    }
  }
}
