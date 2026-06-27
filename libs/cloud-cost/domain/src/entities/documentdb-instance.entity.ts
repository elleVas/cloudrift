// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface DocumentDbInstanceProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  dbInstanceClass: string;
  /** Sum of DatabaseConnections over the observation window. */
  connectionsLastWindow: number;
  metricWindowHours: number;
  instanceCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class DocumentDbInstance extends Entity<string> implements WastedResource {
  private readonly props: Readonly<DocumentDbInstanceProps>;

  constructor(props: DocumentDbInstanceProps) {
    super(props.dbInstanceIdentifier);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get dbInstanceClass(): string { return this.props.dbInstanceClass; }
  get connectionsLastWindow(): number { return this.props.connectionsLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get instanceCreateTime(): Date { return this.props.instanceCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'documentdb-idle-instance' { return 'documentdb-idle-instance'; }
  get wasteReason(): string {
    return `zero connections in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.connectionsLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.dbInstanceClass} DocumentDB instance`);
  }
}
