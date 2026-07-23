// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface CodepipelinePipelineStaleProps {
  pipelineName: string;
  region: AwsRegion;
  accountId: string;
  createdAt: Date;
  /** Start time of the most recent execution; undefined if the pipeline has never run. */
  lastExecutionAt?: Date;
  detectedAt: Date;
  /** Always `{}`: `ListPipelines` doesn't return tags inline (same limitation as Step Functions' `ListStateMachines`). */
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class CodepipelinePipelineStale extends Entity<string> implements WastedResource {
  private readonly props: Readonly<CodepipelinePipelineStaleProps>;

  constructor(props: CodepipelinePipelineStaleProps) {
    super(props.pipelineName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get pipelineName(): string { return this.props.pipelineName; }
  get createdAt(): Date { return this.props.createdAt; }
  get lastExecutionAt(): Date | undefined { return this.props.lastExecutionAt; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'codepipeline-pipeline-stale' { return 'codepipeline-pipeline-stale'; }
  get wasteReason(): string { return 'no pipeline execution within the grace period'; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'active pipeline');
  }
}
