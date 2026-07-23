// SPDX-License-Identifier: Apache-2.0
import {
  CodePipelineClient,
  ListPipelinesCommand,
  ListPipelineExecutionsCommand,
  type PipelineSummary,
} from '@aws-sdk/client-codepipeline';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { CodepipelinePipelineStale, CodepipelinePipelineStalePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

/** Bounds the per-pipeline ListPipelineExecutions fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const EXECUTION_LOOKUP_CONCURRENCY = 5;

type PipelineWithName = PipelineSummary & { name: string; created: Date };

export class AwsCodepipelinePipelineStaleScanner implements WasteScannerPort {
  readonly kind = 'codepipeline-pipeline-stale' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new CodepipelinePipelineStalePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new CodePipelineClient({ ...createAwsClientConfig(), region: region.code });
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
        return new CodepipelinePipelineStale({
          pipelineName: pipeline.name,
          region,
          accountId: this.accountId,
          createdAt: pipeline.created,
          lastExecutionAt,
          detectedAt: now,
          tags: {},
          monthlyCostUsd,
        });
      });

      const results = candidates.filter((p) => this.policy.evaluate(p, now).isWaste);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CodePipeline', err as Error));
    } finally {
      client.destroy();
    }
  }
}
