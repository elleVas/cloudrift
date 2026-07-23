// SPDX-License-Identifier: Apache-2.0
import { ECRClient, DescribeRepositoriesCommand, DescribeImagesCommand, type Repository } from '@aws-sdk/client-ecr';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { EcrRepositoryEmpty, EcrRepositoryEmptyPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

/** Bounds the per-repository DescribeImages fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const IMAGE_LOOKUP_CONCURRENCY = 5;

type RepositoryWithId = Repository & { repositoryArn: string; repositoryName: string; createdAt: Date };

/**
 * Detects ECR repositories with zero images — distinct from
 * `ecr-image-untagged` (cost-waste domain: a dangling image still occupies
 * billed storage). An empty repository is genuinely $0. A repository this
 * scanner can't `DescribeImages` on is skipped, not flagged — same
 * "report what could actually be inspected" reasoning as
 * `AwsS3BucketEmptyScanner`.
 */
export class AwsEcrRepositoryEmptyScanner implements DeadResourceScannerPort {
  readonly kind = 'ecr-repository-empty' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new EcrRepositoryEmptyPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new ECRClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawRepos = await paginate<Repository>(async (cursor) => {
        const r = await client.send(new DescribeRepositoriesCommand({ nextToken: cursor }));
        return { items: r.repositories ?? [], cursor: r.nextToken };
      });
      const validRepos = rawRepos.filter(
        (r): r is RepositoryWithId => !!r.repositoryArn && !!r.repositoryName && !!r.createdAt,
      );

      const now = new Date();
      const candidates = await mapWithConcurrency(validRepos, IMAGE_LOOKUP_CONCURRENCY, async (repo) => {
        try {
          const images = await client.send(new DescribeImagesCommand({ repositoryName: repo.repositoryName, maxResults: 1 }));
          if ((images.imageDetails ?? []).length > 0) return undefined;
          return new EcrRepositoryEmpty({
            repositoryArn: repo.repositoryArn,
            repositoryName: repo.repositoryName,
            region,
            accountId: this.accountId,
            createdAt: repo.createdAt,
            detectedAt: now,
            tags: {},
          });
        } catch (err) {
          logger.debug(`ecr-repository-empty: skipped ${repo.repositoryName}, could not describe images`, { error: (err as Error).message });
          return undefined;
        }
      });

      const results = candidates
        .filter((r): r is EcrRepositoryEmpty => r !== undefined)
        .filter((r) => this.policy.evaluate(r, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ECR', err as Error));
    } finally {
      client.destroy();
    }
  }
}
