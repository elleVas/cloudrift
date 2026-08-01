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
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { SageMakerTrainingOrphaned, SageMakerTrainingOrphanedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';

const ENDPOINT_CONFIG_CONCURRENCY = 5;
// Only orphan candidates pay for a DescribeModel call — the (usually much
// larger) set of models referenced by an endpoint config never does.
const DESCRIBE_MODEL_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

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
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new SageMakerTrainingOrphanedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new SageMakerClient({ ...createAwsClientConfig(this.credentials), region: region.code });
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
          // No dollar estimate: artifact size isn't returned by any
          // ListModels/DescribeModel field, and measuring it would need a
          // HeadObject per model on a bucket cloudrift may not own. This is
          // a namespace-hygiene flag, not a costed finding (see entity doc).
          monthlyCostUsd: 0,
        });
      });

      return Result.ok(entities.filter((model) => this.policy.evaluate(model, now).isWaste));
    } catch (err) {
      return Result.fail(new AwsAdapterError('SageMaker', err));
    } finally {
      client.destroy();
    }
  }
}
