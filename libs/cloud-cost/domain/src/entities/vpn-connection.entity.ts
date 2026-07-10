// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface VpnConnectionProps {
  vpnConnectionId: string;
  region: AwsRegion;
  accountId: string;
  vpnGatewayId: string | undefined;
  transitGatewayId: string | undefined;
  /** Sum of TunnelDataIn + TunnelDataOut over the observation window. */
  tunnelBytesLastWindow: number;
  metricWindowHours: number;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

/** `DescribeVpnConnections` exposes no creation date: no grace period applicable. */
export class VpnConnection extends Entity<string> implements WastedResource {
  private readonly props: Readonly<VpnConnectionProps>;

  constructor(props: VpnConnectionProps) {
    super(props.vpnConnectionId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get vpnGatewayId(): string | undefined { return this.props.vpnGatewayId; }
  get transitGatewayId(): string | undefined { return this.props.transitGatewayId; }
  get tunnelBytesLastWindow(): number { return this.props.tunnelBytesLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'vpn-connection-idle' { return 'vpn-connection-idle'; }
  get wasteReason(): string {
    return `zero tunnel traffic in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.tunnelBytesLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'Idle Site-to-Site VPN connection');
  }
}
