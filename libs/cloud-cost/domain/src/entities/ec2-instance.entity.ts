import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';

export type Ec2InstanceState =
  | 'pending'
  | 'running'
  | 'shutting-down'
  | 'terminated'
  | 'stopping'
  | 'stopped';

export interface AttachedVolume {
  volumeId: string;
  sizeGb: number;
  volumeType: string;
}

export interface Ec2InstanceProps {
  instanceId: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
  state: Ec2InstanceState;
  launchTime: Date;
  detectedAt: Date;
  attachedVolumes: AttachedVolume[];
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class Ec2Instance extends Entity<string> {
  private readonly props: Readonly<Ec2InstanceProps>;

  constructor(props: Ec2InstanceProps) {
    super(props.instanceId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get instanceType(): string { return this.props.instanceType; }
  get state(): Ec2InstanceState { return this.props.state; }
  get launchTime(): Date { return this.props.launchTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get attachedVolumes(): AttachedVolume[] { return this.props.attachedVolumes; }
  get tags(): Record<string, string> { return this.props.tags; }

  isStopped(): boolean {
    return this.props.state === 'stopped';
  }

  get costEstimate(): CostEstimate {
    const totalGb = this.props.attachedVolumes.reduce((s, v) => s + v.sizeGb, 0);
    const volumeSummary =
      this.props.attachedVolumes.length === 0
        ? 'no attached volumes'
        : `${this.props.attachedVolumes.length} vol(s), ${totalGb} GB EBS`;
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `Stopped EC2 — ${volumeSummary} still billed`,
    );
  }
}
