// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * SageMaker model not referenced by any endpoint config's production
 * variants — a training artifact never deployed (or deployed once, then
 * the endpoint deleted). Its own cost is $0 (a `Model` resource itself
 * isn't billed); the value here is namespace hygiene, not a dollar saving.
 * `monthlyCostUsd` is a rough estimate of the S3 storage its artifact
 * occupies (see ADR-0065's caveat: artifact size isn't returned by any
 * `DescribeModel`/`ListModels` field, so it's a flat assumption, not a
 * measured `HeadObject` size).
 */
export interface SageMakerTrainingOrphanedProps {
  modelName: string;
  region: AwsRegion;
  accountId: string;
  modelArn: string;
  primaryContainerImage: string;
  modelDataUrl: string;
  /** Always `false` for entities the scanner builds — see its own doc for why the policy still checks it. */
  referencedByEndpointConfig: boolean;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class SageMakerTrainingOrphaned extends Entity<string> implements WastedResource {
  private readonly props: Readonly<SageMakerTrainingOrphanedProps>;

  constructor(props: SageMakerTrainingOrphanedProps) {
    super(props.modelName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get modelArn(): string { return this.props.modelArn; }
  get primaryContainerImage(): string { return this.props.primaryContainerImage; }
  get modelDataUrl(): string { return this.props.modelDataUrl; }
  get referencedByEndpointConfig(): boolean { return this.props.referencedByEndpointConfig; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'sagemaker-training-orphaned' { return 'sagemaker-training-orphaned'; }

  get wasteReason(): string {
    return `model created ${this.props.creationTime.toISOString().split('T')[0]}, not referenced by any endpoint config`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `SageMaker model ${this.props.modelName} — orphaned, estimated S3 storage cost`,
    );
  }
}
