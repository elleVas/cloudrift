// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface OpenSearchDomainProps {
  domainName: string;
  region: AwsRegion;
  accountId: string;
  instanceType: string;
  instanceCount: number;
  /** Sum of SearchRate + IndexingRate over the observation window. */
  requestsLastWindow: number;
  metricWindowHours: number;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

/**
 * `DescribeDomains` does not expose a creation timestamp, so (like
 * `ElasticIp`/`OrphanedEni`) no grace period can be applied here.
 */
export class OpenSearchDomain extends Entity<string> implements WastedResource {
  private readonly props: Readonly<OpenSearchDomainProps>;

  constructor(props: OpenSearchDomainProps) {
    super(props.domainName);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get instanceType(): string { return this.props.instanceType; }
  get instanceCount(): number { return this.props.instanceCount; }
  get requestsLastWindow(): number { return this.props.requestsLastWindow; }
  get metricWindowHours(): number { return this.props.metricWindowHours; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'opensearch-idle-domain' { return 'opensearch-idle-domain'; }
  get wasteReason(): string {
    return `zero search/indexing requests in last ${this.props.metricWindowHours}h`;
  }

  isIdle(): boolean {
    return this.props.requestsLastWindow === 0;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.instanceType} OpenSearch domain`);
  }
}
