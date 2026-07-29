// SPDX-License-Identifier: Apache-2.0
import {
  CodePipelineClient,
  ListPipelinesCommand,
  ListPipelineExecutionsCommand,
  type PipelineSummary,
} from '@aws-sdk/client-codepipeline';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { CodepipelinePipelineStale, CodepipelinePipelineStalePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';

/** Bounds the per-pipeline ListPipelineExecutions fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const EXECUTION_LOOKUP_CONCURRENCY = 5;

type PipelineWithName = PipelineSummary & { name: string; created: Date };

export class AwsCodepipelinePipelineStaleScanner implements WasteScannerPort {
  readonly kind = 'codepipeline-pipeline-stale' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new CodepipelinePipelineStalePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new CodePipelineClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawPipelines = await paginate<PipelineSummary>(async (cursor) => {
        const r = await client.send(new ListPipelinesCommand({ nextToken: cursor }));
        return { items: r.pipelines ?? [], cursor: r.nextToken };
      });
      const pipelines = rawPipelines.filter(
        (p): p is PipelineWithName => !!p.name && !!p.created,
      );

      const now = new Date();
      const monthlyCostUsd = this.pricing.getPrice(region, 'codepipeline-pipeline');
      const candidates = await mapWithConcurrency(pipelines, EXECUTION_LOOKUP_CONCURRENCY, async (pipeline) => {
        const r = await client.send(
          new ListPipelineExecutionsCommand({ pipelineName: pipeline.name, maxResults: 1 }),
        );
        const lastExecutionAt = r.pipelineExecutionSummaries?.[0]?.startTime;
        const props = {
          pipelineName: pipeline.name,
          region,
          accountId: this.accountId,
          createdAt: pipeline.created,
          lastExecutionAt,
          detectedAt: now,
          tags: {},
          monthlyCostUsd,
        };
        const verdict = this.policy.evaluate(new CodepipelinePipelineStale({ ...props, wasteReason: '' }), now);
        return verdict.isWaste ? new CodepipelinePipelineStale({ ...props, wasteReason: verdict.reason }) : null;
      });

      const results = candidates.filter((p): p is CodepipelinePipelineStale => p !== null);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CodePipeline', err));
    } finally {
      client.destroy();
    }
  }
}
