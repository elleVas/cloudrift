// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface SecretsManagerUnusedProps {
  arn: string;
  region: AwsRegion;
  accountId: string;
  name: string;
  createdDate: Date;
  lastAccessedDate?: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class SecretsManagerUnused extends Entity<string> implements WastedResource {
  private readonly props: Readonly<SecretsManagerUnusedProps>;

  constructor(props: SecretsManagerUnusedProps) {
    super(props.arn);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get name(): string { return this.props.name; }
  get createdDate(): Date { return this.props.createdDate; }
  get lastAccessedDate(): Date | undefined { return this.props.lastAccessedDate; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'secretsmanager-unused' { return 'secretsmanager-unused'; }
  get wasteReason(): string {
    return this.props.lastAccessedDate ? 'not accessed within the grace period' : 'never accessed';
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, 'unused secret, flat monthly cost');
  }
}
