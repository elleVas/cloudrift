// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface ElasticIpProps {
  allocationId: string;
  publicIp: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  associationId?: string;
  instanceId?: string;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class ElasticIp extends Entity<string> implements WastedResource {
  private readonly props: Readonly<ElasticIpProps>;

  constructor(props: ElasticIpProps) {
    super(props.allocationId);
    this.props = this.deepFreeze({ ...props });
  }

  get publicIp(): string { return this.props.publicIp; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get associationId(): string | undefined { return this.props.associationId; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'elastic-ip' { return 'elastic-ip'; }
  get wasteReason(): string { return 'unassociated'; }

  isUnassociated(): boolean {
    return !this.props.associationId;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'Unassociated Elastic IP');
  }
}
