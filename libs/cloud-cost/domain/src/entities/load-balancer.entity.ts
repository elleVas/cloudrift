import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';

export type LoadBalancerType = 'application' | 'network' | 'gateway';

export interface LoadBalancerProps {
  arn: string;
  name: string;
  region: AwsRegion;
  accountId: string;
  type: LoadBalancerType;
  createdTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class LoadBalancer extends Entity<string> {
  private readonly props: Readonly<LoadBalancerProps>;

  constructor(props: LoadBalancerProps) {
    super(props.arn);
    this.props = Object.freeze({ ...props });
  }

  get name(): string { return this.props.name; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get type(): LoadBalancerType { return this.props.type; }
  get createdTime(): Date { return this.props.createdTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `Idle ${this.props.type} load balancer`,
    );
  }
}
