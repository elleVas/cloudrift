// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface KinesisStreamProps {
  streamName: string;
  region: AwsRegion;
  accountId: string;
  openShardCount: number;
  /** Sum of IncomingBytes + IncomingRecords over the observation window. */
  incomingActivityLastWindow: number;
  metricWindowHours: number;
  streamCreationTimestamp: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

/** Only streams in PROVISIONED mode are scanned: On-Demand bills per use, not a fixed cost (ADR-0038). */
export class KinesisStream extends Entity<string> implements WastedResource {
  private readonly props: Readonly<KinesisStreamProps>;

  constructor(props: KinesisStreamProps) {
    super(props.streamName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get openShardCount(): number { return this.props.openShardCount; }
  get incomingActivityLastWindow(): number { return this.props.incomingActivityLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get streamCreationTimestamp(): Date { return this.props.streamCreationTimestamp; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'kinesis-provisioned-idle-stream' { return 'kinesis-provisioned-idle-stream'; }
  get wasteReason(): string {
    return `zero incoming records in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.incomingActivityLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle Provisioned Kinesis stream (${this.props.openShardCount} shards)`);
  }
}
