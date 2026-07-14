// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * SageMaker real-time inference endpoint `InService` with zero invocations
 * over the observation window — instances behind it are billed 730h/month
 * regardless of traffic, same always-on billing shape as an idle RDS/EC2
 * instance.
 *
 * `instanceType`/`instanceCount` describe the endpoint's first production
 * variant; multi-variant (A/B testing) endpoints are priced on that variant
 * only (documented limitation — see ADR-0065).
 */
export interface SageMakerEndpointIdleProps {
  endpointName: string;
  region: AwsRegion;
  accountId: string;
  endpointConfigName: string;
  instanceType: string;
  instanceCount: number;
  status: string;
  invocationsLastWindow: number;
  windowHours: number;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class SageMakerEndpointIdle extends Entity<string> implements WastedResource {
  private readonly props: Readonly<SageMakerEndpointIdleProps>;

  constructor(props: SageMakerEndpointIdleProps) {
    super(props.endpointName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get endpointConfigName(): string { return this.props.endpointConfigName; }
  get instanceType(): string { return this.props.instanceType; }
  get instanceCount(): number { return this.props.instanceCount; }
  get status(): string { return this.props.status; }
  get invocationsLastWindow(): number { return this.props.invocationsLastWindow; }
  get windowHours(): number { return this.props.windowHours; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'sagemaker-endpoint-idle' { return 'sagemaker-endpoint-idle'; }

  get wasteReason(): string {
    return `${this.props.status}, zero invocations over ${this.props.windowHours}h — ${this.props.instanceCount}x ${this.props.instanceType}`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `SageMaker endpoint ${this.props.instanceCount}x ${this.props.instanceType} — idle`,
    );
  }
}
