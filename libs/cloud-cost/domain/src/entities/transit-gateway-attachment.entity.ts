// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface TransitGatewayAttachmentProps {
  transitGatewayAttachmentId: string;
  region: AwsRegion;
  accountId: string;
  transitGatewayId: string;
  resourceType: string;
  /** Sum of BytesIn + BytesOut over the observation window. */
  bytesLastWindow: number;
  metricWindowHours: number;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class TransitGatewayAttachment extends Entity<string> implements WastedResource {
  private readonly props: Readonly<TransitGatewayAttachmentProps>;

  constructor(props: TransitGatewayAttachmentProps) {
    super(props.transitGatewayAttachmentId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get transitGatewayId(): string { return this.props.transitGatewayId; }
  get resourceType(): string { return this.props.resourceType; }
  get bytesLastWindow(): number { return this.props.bytesLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'transit-gateway-idle-attachment' { return 'transit-gateway-idle-attachment'; }
  get wasteReason(): string {
    return `zero traffic in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.bytesLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle Transit Gateway ${this.props.resourceType} attachment`);
  }
}
