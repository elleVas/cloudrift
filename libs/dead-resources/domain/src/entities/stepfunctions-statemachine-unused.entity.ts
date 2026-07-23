// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface StepfunctionsStatemachineUnusedProps {
  stateMachineArn: string;
  name: string;
  region: AwsRegion;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * STANDARD-type Step Functions state machine with zero executions ever —
 * genuinely $0 cost, both types are billed per state transition/request,
 * never at rest. EXPRESS-type machines are excluded by the scanner:
 * `ListExecutions` doesn't cover them (their execution history lives only
 * in CloudWatch Logs), so "never executed" can't be verified the same way.
 * `ListStateMachines` doesn't return tags inline, so `tags` is always `{}`.
 */
export class StepfunctionsStatemachineUnused extends Entity<string> implements DeadResource {
  private readonly props: Readonly<StepfunctionsStatemachineUnusedProps>;

  constructor(props: StepfunctionsStatemachineUnusedProps) {
    super(props.stateMachineArn);
    this.props = this.deepFreeze({ ...props });
  }

  get name(): string {
    return this.props.name;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'stepfunctions-statemachine-unused' {
    return 'stepfunctions-statemachine-unused';
  }

  get hygieneReason(): string {
    return 'has never been executed';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
