import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface IdleElastiCacheClusterProps {
  cacheClusterId: string;
  region: AwsRegion;
  accountId: string;
  cacheNodeType: string;
  numCacheNodes: number;
  /** Somma di CurrConnections nella finestra di osservazione. */
  connectionsLastWindow: number;
  metricWindowHours: number;
  createTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class IdleElastiCacheCluster extends Entity<string> implements WastedResource {
  private readonly props: Readonly<IdleElastiCacheClusterProps>;

  constructor(props: IdleElastiCacheClusterProps) {
    super(props.cacheClusterId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get cacheNodeType(): string { return this.props.cacheNodeType; }
  get numCacheNodes(): number { return this.props.numCacheNodes; }
  get connectionsLastWindow(): number { return this.props.connectionsLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get createTime(): Date { return this.props.createTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'elasticache-idle' { return 'elasticache-idle'; }
  get wasteReason(): string {
    return `zero connections in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.connectionsLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.cacheNodeType} ElastiCache cluster`);
  }
}
