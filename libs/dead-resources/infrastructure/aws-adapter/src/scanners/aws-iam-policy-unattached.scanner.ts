// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListPoliciesCommand, type Policy } from '@aws-sdk/client-iam';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { IamPolicyUnattached, IamPolicyUnattachedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

/** IAM has a single global endpoint — always sign against this region, never the one `scan()` receives (ADR-0078). */
const IAM_ENDPOINT_REGION = 'us-east-1';

type PolicyWithId = Policy & { PolicyId: string; PolicyName: string; Arn: string; CreateDate: Date };

/**
 * Detects customer-managed IAM policies attached to no user, group, or
 * role. `Scope: 'Local'` filters out AWS-managed policies server-side
 * (ADR-0019) — the account can't delete those anyway, so there is nothing
 * to flag there. `scope: 'global'` — IAM has no per-region data, see
 * `DeadResourceScannerPort` and ADR-0078.
 */
export class AwsIamPolicyUnattachedScanner implements DeadResourceScannerPort {
  readonly kind = 'iam-policy-unattached' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamPolicyUnattachedPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const rawPolicies = await paginate<Policy>(async (cursor) => {
        const r = await client.send(new ListPoliciesCommand({ Scope: 'Local', Marker: cursor }));
        return { items: r.Policies ?? [], cursor: r.Marker };
      });

      const now = new Date();
      const validPolicies = rawPolicies.filter(
        (p): p is PolicyWithId => !!p.PolicyId && !!p.PolicyName && !!p.Arn && !!p.CreateDate,
      );

      const results = validPolicies
        .filter((p) => (p.AttachmentCount ?? 0) === 0)
        .map(
          (p) =>
            new IamPolicyUnattached({
              policyId: p.PolicyId,
              policyName: p.PolicyName,
              arn: p.Arn,
              accountId: this.accountId,
              createdAt: p.CreateDate,
              detectedAt: now,
              tags: Object.fromEntries((p.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((p) => this.policy.evaluate(p, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
