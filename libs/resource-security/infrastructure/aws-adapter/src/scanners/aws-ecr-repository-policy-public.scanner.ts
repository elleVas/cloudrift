// SPDX-License-Identifier: Apache-2.0
import { ECRClient, DescribeRepositoriesCommand, GetRepositoryPolicyCommand, type Repository } from '@aws-sdk/client-ecr';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { EcrRepositoryPolicyPublic, EcrRepositoryPolicyPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig, parsePolicyStatements, isWildcardPrincipal } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-repository `GetRepositoryPolicy` calls in flight at once. */
const REPO_CHECK_CONCURRENCY = 8;

type RepositoryWithId = Repository & { repositoryName: string; repositoryArn: string };

function isPublicPolicy(policyJson: string | undefined): boolean {
  return parsePolicyStatements(policyJson).some((s) => s.Effect === 'Allow' && isWildcardPrincipal(s.Principal) && s.Condition === undefined);
}

/** Detects ECR repositories with a repository policy granting access to any AWS principal, with no restricting condition. */
export class AwsEcrRepositoryPolicyPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 'ecr-repository-policy-public' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new EcrRepositoryPolicyPublicPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new ECRClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawRepos = await paginate<Repository>(async (cursor) => {
        const r = await client.send(new DescribeRepositoriesCommand({ nextToken: cursor }));
        return { items: r.repositories ?? [], cursor: r.nextToken };
      });
      const validRepos = rawRepos.filter((r): r is RepositoryWithId => !!r.repositoryName && !!r.repositoryArn);
      const now = new Date();

      const candidates = await mapWithConcurrency(validRepos, REPO_CHECK_CONCURRENCY, async (repo) => {
        try {
          const { policyText } = await client.send(new GetRepositoryPolicyCommand({ repositoryName: repo.repositoryName }));
          if (!isPublicPolicy(policyText)) return undefined;
          return new EcrRepositoryPolicyPublic({ repositoryName: repo.repositoryName, repositoryArn: repo.repositoryArn, region, accountId: this.accountId, detectedAt: now, tags: {} });
        } catch (err) {
          // No policy at all (`RepositoryPolicyNotFoundException`) is the common case and isn't public;
          // any other per-repository error also shouldn't fail the whole scan.
          logger.debug('ecr-repository-policy-public: skipping repository after error', { repositoryName: repo.repositoryName, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is EcrRepositoryPolicyPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ECR', err));
    } finally {
      client.destroy();
    }
  }
}
