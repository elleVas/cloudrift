// SPDX-License-Identifier: Apache-2.0
import {
  ECRClient,
  DescribeRepositoriesCommand,
  DescribeImagesCommand,
  type ImageDetail,
  type Repository,
} from '@aws-sdk/client-ecr';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { EcrImageUntagged, EcrImageUntaggedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');
const REPO_CONCURRENCY = 5;

type ImageDetailWithDigest = ImageDetail & { imageDigest: string };

/**
 * Detects untagged (dangling) images across every repository in the region.
 * ECR's `tags` concept (AWS resource tags) applies at the repository level,
 * not per-image — there is no `cloudrift:ignore` exclusion at the image
 * granularity, only Docker image tags (which is what "untagged" means here).
 */
export class AwsEcrImageUntaggedScanner implements WasteScannerPort {
  readonly kind = 'ecr-image-untagged' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EcrImageUntaggedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new ECRClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const repositories = await paginate<Repository>(async (cursor) => {
        const r = await client.send(new DescribeRepositoriesCommand({ nextToken: cursor }));
        return { items: r.repositories ?? [], cursor: r.nextToken };
      });
      const repoNames = repositories.filter((r): r is Repository & { repositoryName: string } => !!r.repositoryName);

      const perRepoImages = await mapWithConcurrency(repoNames, REPO_CONCURRENCY, (repo) =>
        paginate<ImageDetail>(async (cursor) => {
          const r = await client.send(
            new DescribeImagesCommand({ repositoryName: repo.repositoryName, nextToken: cursor }),
          );
          return { items: r.imageDetails ?? [], cursor: r.nextToken };
        }).then((images) => images.map((img) => ({ repositoryName: repo.repositoryName, image: img }))),
      );

      const now = new Date();
      const pricePerGb = this.pricing.getPrice(region, 'ecr-storage');
      const rawImages = perRepoImages.flat();
      const validImages = rawImages.filter(
        (entry): entry is { repositoryName: string; image: ImageDetailWithDigest } => !!entry.image.imageDigest,
      );
      if (validImages.length !== rawImages.length) {
        logger.debug(`${this.kind}: skipped ${rawImages.length - validImages.length} entries missing imageDigest`);
      }

      const untagged = validImages
        .filter(({ image }) => !image.imageTags || image.imageTags.length === 0)
        .map(({ repositoryName, image }) => {
          const sizeBytes = image.imageSizeInBytes ?? 0;
          const sizeGb = sizeBytes / 1024 ** 3;
          return new EcrImageUntagged({
            imageDigest: image.imageDigest,
            region,
            accountId: this.accountId,
            repositoryName,
            sizeBytes,
            imagePushedAt: image.imagePushedAt ?? new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +(sizeGb * pricePerGb).toFixed(4),
          });
        })
        .filter((image) => this.policy.evaluate(image, now).isWaste);

      return Result.ok(untagged);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ECR', err as Error));
    } finally {
      client.destroy();
    }
  }
}
