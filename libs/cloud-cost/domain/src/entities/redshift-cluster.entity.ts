// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface RedshiftClusterProps {
  clusterIdentifier: string;
  region: AwsRegion;
  accountId: string;
  nodeType: string;
  numberOfNodes: number;
  /** Sum of DatabaseConnections over the observation window. */
  connectionsLastWindow: number;
  metricWindowHours: number;
  clusterCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class RedshiftCluster extends Entity<string> implements WastedResource {
  private readonly props: Readonly<RedshiftClusterProps>;

  constructor(props: RedshiftClusterProps) {
    super(props.clusterIdentifier);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get nodeType(): string { return this.props.nodeType; }
  get numberOfNodes(): number { return this.props.numberOfNodes; }
  get connectionsLastWindow(): number { return this.props.connectionsLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get clusterCreateTime(): Date { return this.props.clusterCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'redshift-idle-cluster' { return 'redshift-idle-cluster'; }
  get wasteReason(): string {
    return `zero connections in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.connectionsLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.nodeType} Redshift cluster`);
  }
}
