// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface MqBrokerProps {
  brokerId: string;
  brokerName: string;
  region: AwsRegion;
  accountId: string;
  hostInstanceType: string;
  deploymentMode: string;
  /** Sum of NetworkIn over the observation window (engine-agnostic traffic signal). */
  networkBytesLastWindow: number;
  metricWindowHours: number;
  created: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class MqBroker extends Entity<string> implements WastedResource {
  private readonly props: Readonly<MqBrokerProps>;

  constructor(props: MqBrokerProps) {
    super(props.brokerId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get brokerName(): string { return this.props.brokerName; }
  get hostInstanceType(): string { return this.props.hostInstanceType; }
  get deploymentMode(): string { return this.props.deploymentMode; }
  get networkBytesLastWindow(): number { return this.props.networkBytesLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get created(): Date { return this.props.created; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'mq-idle-broker' { return 'mq-idle-broker'; }
  get wasteReason(): string {
    return `zero network traffic in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.networkBytesLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.hostInstanceType} MQ broker`);
  }
}
