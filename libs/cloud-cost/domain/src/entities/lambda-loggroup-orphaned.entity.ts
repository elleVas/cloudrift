// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface LambdaLogGroupOrphanedProps {
  logGroupName: string;
  functionName: string;
  functionExists: boolean;
  storedBytes: number;
  lastEventTimestamp: Date;
  region: AwsRegion;
  accountId: string;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

/**
 * CloudWatch Log Group under `/aws/lambda/` whose Lambda function no longer
 * exists — distinct from the `log-group` scanner, which flags missing
 * retention on log groups that still belong to a live function. This one
 * flags a log group left behind after the function itself was deleted.
 */
export class LambdaLogGroupOrphaned extends Entity<string> implements WastedResource {
  private readonly props: Readonly<LambdaLogGroupOrphanedProps>;

  constructor(props: LambdaLogGroupOrphanedProps) {
    super(props.logGroupName);
    this.props = this.deepFreeze({ ...props });
  }

  get logGroupName(): string { return this.props.logGroupName; }
  get functionName(): string { return this.props.functionName; }
  get functionExists(): boolean { return this.props.functionExists; }
  get storedBytes(): number { return this.props.storedBytes; }
  get lastEventTimestamp(): Date { return this.props.lastEventTimestamp; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get tags(): Record<string, string> { return this.props.tags; }

  get detectedAt(): Date { return new Date(); }
  get kind(): 'lambda-loggroup-orphaned' { return 'lambda-loggroup-orphaned'; }
  get wasteReason(): string {
    return `function ${this.props.functionName} no longer exists`;
  }

  get costEstimate(): CostEstimate {
    const storedGb = (this.props.storedBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(this.props.monthlyCostUsd, `${storedGb} GB CW logs (orphaned Lambda log group)`);
  }
}
