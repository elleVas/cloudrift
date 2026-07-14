// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * SageMaker notebook instance `InService` with maximum CPU below threshold
 * over the observation window — GPU-backed notebook types can cost hundreds
 * to thousands of $/day, and (unlike EC2) there is no "stopped and still
 * billed for the EBS volume only" middle ground worth distinguishing here.
 * CPU is the only signal available without extra IAM permissions: it cannot
 * see Jupyter kernel activity, so a human reading a notebook without running
 * any cell looks identical to true idle (documented caveat).
 */
export interface SageMakerNotebookIdleProps {
  notebookInstanceName: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
  status: string;
  maxCpuPercent: number;
  windowHours: number;
  lastModifiedTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class SageMakerNotebookIdle extends Entity<string> implements WastedResource {
  private readonly props: Readonly<SageMakerNotebookIdleProps>;

  constructor(props: SageMakerNotebookIdleProps) {
    super(props.notebookInstanceName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get instanceType(): string { return this.props.instanceType; }
  get status(): string { return this.props.status; }
  get maxCpuPercent(): number { return this.props.maxCpuPercent; }
  get windowHours(): number { return this.props.windowHours; }
  get lastModifiedTime(): Date { return this.props.lastModifiedTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'sagemaker-notebook-idle' { return 'sagemaker-notebook-idle'; }

  get wasteReason(): string {
    return `${this.props.status}, max CPU ${this.props.maxCpuPercent.toFixed(1)}% over ${this.props.windowHours}h — checks CPU only, not Jupyter kernel activity`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `SageMaker notebook ${this.props.instanceType} — idle`,
    );
  }
}
