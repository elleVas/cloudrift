// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface MskClusterProps {
  clusterName: string;
  region: AwsRegion;
  accountId: string;
  brokerInstanceType: string;
  numberOfBrokerNodes: number;
  /** Sum of BytesInPerSec + BytesOutPerSec over the observation window. */
  bytesLastWindow: number;
  metricWindowHours: number;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class MskCluster extends Entity<string> implements WastedResource {
  private readonly props: Readonly<MskClusterProps>;

  constructor(props: MskClusterProps) {
    super(props.clusterName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get brokerInstanceType(): string { return this.props.brokerInstanceType; }
  get numberOfBrokerNodes(): number { return this.props.numberOfBrokerNodes; }
  get bytesLastWindow(): number { return this.props.bytesLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'msk-idle-cluster' { return 'msk-idle-cluster'; }
  get wasteReason(): string {
    return `zero broker traffic in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.bytesLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.brokerInstanceType} MSK cluster`);
  }
}
