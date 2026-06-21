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
  /** Somma di ConsumedReadCapacityUnits nella finestra di osservazione. */
  consumedReadCapacityUnits: number;
  /** Somma di ConsumedWriteCapacityUnits nella finestra di osservazione. */
  consumedWriteCapacityUnits: number;
  windowDays: number;
  creationDateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  /** Risparmio mensile stimato da un downsize della capacità provisioned. */
  monthlyCostUsd: number;
}

/**
 * Tabella DynamoDB in modalità PROVISIONED con capacità RCU/WCU consumata
 * ben sotto quella allocata. Advisory (categoria optimization, stima): la
 * CPU bassa non garantisce che il traffico sia sempre basso (picchi non
 * coperti dalla finestra), va verificato prima di un downsize.
 */
export class OverprovisionedDynamoDbTable extends Entity<string> implements WastedResource {
  private readonly props: Readonly<OverprovisionedDynamoDbTableProps>;

  constructor(props: OverprovisionedDynamoDbTableProps) {
    super(props.tableName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get readCapacityUnits(): number { return this.props.readCapacityUnits; }
  get writeCapacityUnits(): number { return this.props.writeCapacityUnits; }
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
      `${this.props.readCapacityUnits} RCU / ${this.props.writeCapacityUnits} WCU overprovisioned`,
    );
  }
}
