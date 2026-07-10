// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export type LoadBalancerType = 'application' | 'network' | 'gateway';

export interface LoadBalancerProps {
  arn: string;
  name: string;
  region: AwsRegion;
  accountId: string;
  type: LoadBalancerType;
  createdTime: Date;
  detectedAt: Date;
  registeredTargetCount: number;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class LoadBalancer extends Entity<string> implements WastedResource {
  private readonly props: Readonly<LoadBalancerProps>;

  constructor(props: LoadBalancerProps) {
    super(props.arn);
    this.props = this.deepFreeze({ ...props });
  }

  get name(): string { return this.props.name; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get type(): LoadBalancerType { return this.props.type; }
  get createdTime(): Date { return this.props.createdTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get registeredTargetCount(): number { return this.props.registeredTargetCount; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'load-balancer' { return 'load-balancer'; }
  get wasteReason(): string { return 'no registered targets'; }

  isIdle(): boolean {
    return this.props.registeredTargetCount === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `Idle ${this.props.type} load balancer`,
    );
  }
}
