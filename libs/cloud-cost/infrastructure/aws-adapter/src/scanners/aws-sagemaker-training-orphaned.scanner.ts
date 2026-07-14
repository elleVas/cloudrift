// SPDX-License-Identifier: Apache-2.0
import {
  SageMakerClient,
  ListModelsCommand,
  ListEndpointConfigsCommand,
  DescribeEndpointConfigCommand,
  DescribeModelCommand,
  type ModelSummary,
  type EndpointConfigSummary,
} from '@aws-sdk/client-sagemaker';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { SageMakerTrainingOrphaned, SageMakerTrainingOrphanedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const ENDPOINT_CONFIG_CONCURRENCY = 5;
// Only orphan candidates pay for a DescribeModel call — the (usually much
// larger) set of models referenced by an endpoint config never does.
const DESCRIBE_MODEL_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

/**
 * Flat per-model artifact size assumption, priced via the static S3
 * Standard rate. `ListModels`/`DescribeModel` don't report artifact size —
 * measuring it would require a `HeadObject` per model on whatever bucket
 * `ModelDataUrl` points at (extra IAM permission, cross-account risk if the
 * bucket isn't the caller's). Documented caveat (ADR-0065): the dollar
 * figure is a rough estimate, the real value of this finding is namespace
 * hygiene (orphaned models), not the saving itself.
 */
const ASSUMED_MODEL_ARTIFACT_GB = 5;

type ModelWithName = ModelSummary & { ModelName: string };
type EndpointConfigWithName = EndpointConfigSummary & { EndpointConfigName: string };

/**
 * Detects SageMaker models not referenced by any endpoint config's
 * production variants — a training artifact never deployed, or deployed
 * once and orphaned after the endpoint was deleted.
 */
export class AwsSageMakerTrainingOrphanedScanner implements WasteScannerPort {
  readonly kind = 'sagemaker-training-orphaned' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new SageMakerTrainingOrphanedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new SageMakerClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const [rawModels, rawConfigs] = await Promise.all([
        paginate<ModelSummary>(async (cursor) => {
          const r = await client.send(new ListModelsCommand({ NextToken: cursor }));
          return { items: r.Models ?? [], cursor: r.NextToken };
        }),
        paginate<EndpointConfigSummary>(async (cursor) => {
          const r = await client.send(new ListEndpointConfigsCommand({ NextToken: cursor }));
          return { items: r.EndpointConfigs ?? [], cursor: r.NextToken };
        }),
      ]);

      const models = rawModels.filter((m): m is ModelWithName => !!m.ModelName);
      if (models.length !== rawModels.length) {
        logger.debug(`${this.kind}: skipped ${rawModels.length - models.length} entries missing ModelName`);
      }
      const configs = rawConfigs.filter((c): c is EndpointConfigWithName => !!c.EndpointConfigName);

      const referencedModelNames = new Set<string>();
      await mapWithConcurrency(configs, ENDPOINT_CONFIG_CONCURRENCY, async (config) => {
        const r = await client.send(
          new DescribeEndpointConfigCommand({ EndpointConfigName: config.EndpointConfigName }),
        );
        for (const variant of r.ProductionVariants ?? []) {
          if (variant.ModelName) referencedModelNames.add(variant.ModelName);
        }
      });

      const orphanCandidates = models.filter((m) => !referencedModelNames.has(m.ModelName));

      const pricePerGb = this.pricing.getPrice(region, 's3-standard');
      const now = new Date();
      const entities = await mapWithConcurrency(orphanCandidates, DESCRIBE_MODEL_CONCURRENCY, async (model) => {
        const detail = await client.send(new DescribeModelCommand({ ModelName: model.ModelName }));
        return new SageMakerTrainingOrphaned({
          modelName: model.ModelName,
          region,
          accountId: this.accountId,
          modelArn: model.ModelArn ?? '',
          primaryContainerImage: detail.PrimaryContainer?.Image ?? '',
          modelDataUrl: detail.PrimaryContainer?.ModelDataUrl ?? '',
          referencedByEndpointConfig: false,
          creationTime: model.CreationTime ?? new Date(0),
          detectedAt: now,
          // ListModels/DescribeModel don't return tags.
          tags: {},
          monthlyCostUsd: +(ASSUMED_MODEL_ARTIFACT_GB * pricePerGb).toFixed(4),
        });
      });

      return Result.ok(entities.filter((model) => this.policy.evaluate(model, now).isWaste));
    } catch (err) {
      return Result.fail(new AwsAdapterError('SageMaker', err as Error));
    } finally {
      client.destroy();
    }
  }
}
