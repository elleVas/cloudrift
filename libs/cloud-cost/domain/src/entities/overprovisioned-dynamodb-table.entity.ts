// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface OverprovisionedDynamoDbTableProps {
  tableName: string;
  region: AwsRegion;
  accountId: string;
  readCapacityUnits: number;
  writeCapacityUnits: number;
  /** Sum of ConsumedReadCapacityUnits over the observation window. */
  consumedReadCapacityUnits: number;
  /** Sum of ConsumedWriteCapacityUnits over the observation window. */
  consumedWriteCapacityUnits: number;
  /** Real downsize recommendation (average consumed rate × safety margin, capped at the current allocation). See class doc. */
  recommendedReadCapacityUnits: number;
  recommendedWriteCapacityUnits: number;
  windowDays: number;
  creationDateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  /** Real price difference between current and recommended RCU/WCU, not a heuristic fraction. */
  monthlyCostUsd: number;
}

/**
 * DynamoDB table in PROVISIONED mode with consumed RCU/WCU capacity well
 * below the allocated amount. Advisory (optimization category): low
 * utilization does not guarantee traffic is always low (spikes not covered
 * by the window), must be verified before a downsize.
 * `monthlyCostUsd` is a real price subtraction: current RCU/WCU cost minus
 * the recommended RCU/WCU's cost. The recommendation itself is derived from
 * the *average* consumed rate over the window (CloudWatch is queried for a
 * single aggregate Sum, not per-period datapoints, so there's no true peak
 * signal here) times a 3x safety margin, floored at 1 unit and capped at the
 * current allocation — a conservative stand-in for the peak visibility this
 * scanner doesn't have, not a guess unconnected to real usage.
 */
export class OverprovisionedDynamoDbTable extends Entity<string> implements WastedResource {
  private readonly props: Readonly<OverprovisionedDynamoDbTableProps>;

  constructor(props: OverprovisionedDynamoDbTableProps) {
    super(props.tableName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get readCapacityUnits(): number { return this.props.readCapacityUnits; }
  get writeCapacityUnits(): number { return this.props.writeCapacityUnits; }
  get recommendedReadCapacityUnits(): number { return this.props.recommendedReadCapacityUnits; }
  get recommendedWriteCapacityUnits(): number { return this.props.recommendedWriteCapacityUnits; }
  get windowDays(): number { return this.props.windowDays; }
  get creationDateTime(): Date { return this.props.creationDateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'dynamodb-overprovisioned' { return 'dynamodb-overprovisioned'; }
  get wasteReason(): string {
    return `read ${this.avgReadUtilizationPercent.toFixed(1)}% / write ${this.avgWriteUtilizationPercent.toFixed(1)}% utilization over ${this.props.windowDays}d (verify traffic spikes before downsizing)`;
  }

  private utilizationPercent(consumed: number, provisioned: number): number {
    if (provisioned <= 0) return 0;
    const windowSeconds = this.props.windowDays * 24 * 60 * 60;
    return (consumed / windowSeconds / provisioned) * 100;
  }

  get avgReadUtilizationPercent(): number {
    return this.utilizationPercent(this.props.consumedReadCapacityUnits, this.props.readCapacityUnits);
  }

  get avgWriteUtilizationPercent(): number {
    return this.utilizationPercent(this.props.consumedWriteCapacityUnits, this.props.writeCapacityUnits);
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.readCapacityUnits} RCU / ${this.props.writeCapacityUnits} WCU → ` +
        `${this.props.recommendedReadCapacityUnits} RCU / ${this.props.recommendedWriteCapacityUnits} WCU ` +
        `(avg usage × 3x margin, real price difference)`,
    );
  }
}
