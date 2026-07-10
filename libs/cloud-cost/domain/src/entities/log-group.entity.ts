// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface LogGroupProps {
  logGroupName: string;
  region: AwsRegion;
  accountId: string;
  storedBytes: number;
  retentionInDays?: number;
  creationTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class LogGroup extends Entity<string> implements WastedResource {
  private readonly props: Readonly<LogGroupProps>;

  constructor(props: LogGroupProps) {
    super(props.logGroupName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get storedBytes(): number { return this.props.storedBytes; }
  get creationTime(): Date { return this.props.creationTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'log-group' { return 'log-group'; }
  get wasteReason(): string { return 'no retention policy'; }

  hasRetentionPolicy(): boolean {
    return this.props.retentionInDays !== undefined;
  }

  get costEstimate(): CostEstimate {
    const storedGb = (this.props.storedBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(this.props.monthlyCostUsd, `${storedGb} GB CW logs (no retention)`);
  }
}
