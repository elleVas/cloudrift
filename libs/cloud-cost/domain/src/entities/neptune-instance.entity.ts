// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface NeptuneInstanceProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  dbInstanceClass: string;
  /** Sum of TotalRequestsPerSec (Gremlin/SPARQL/openCypher/loader combined) over the observation window. */
  requestsLastWindow: number;
  metricWindowHours: number;
  instanceCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class NeptuneInstance extends Entity<string> implements WastedResource {
  private readonly props: Readonly<NeptuneInstanceProps>;

  constructor(props: NeptuneInstanceProps) {
    super(props.dbInstanceIdentifier);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get dbInstanceClass(): string { return this.props.dbInstanceClass; }
  get requestsLastWindow(): number { return this.props.requestsLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get instanceCreateTime(): Date { return this.props.instanceCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'neptune-idle-instance' { return 'neptune-idle-instance'; }
  get wasteReason(): string {
    return `zero query traffic in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.requestsLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.dbInstanceClass} Neptune instance`);
  }
}
