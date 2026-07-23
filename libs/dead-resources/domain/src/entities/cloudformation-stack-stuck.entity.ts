// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface CloudformationStackStuckProps {
  stackId: string;
  stackName: string;
  status: string;
  region: AwsRegion;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * CloudFormation stack permanently stuck in a failed terminal state
 * (`CREATE_FAILED`, `ROLLBACK_FAILED`, `DELETE_FAILED`,
 * `UPDATE_ROLLBACK_FAILED` — the scanner's `DescribeStacksCommand` filter).
 * Unlike every other kind in this domain, this is `critical`: a stuck stack
 * actively blocks further stack operations and often leaves orphaned
 * resources behind, not just idle cleanup.
 */
export class CloudformationStackStuck extends Entity<string> implements DeadResource {
  private readonly props: Readonly<CloudformationStackStuckProps>;

  constructor(props: CloudformationStackStuckProps) {
    super(props.stackId);
    this.props = this.deepFreeze({ ...props });
  }

  get stackName(): string {
    return this.props.stackName;
  }

  get status(): string {
    return this.props.status;
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

  get kind(): 'cloudformation-stack-stuck' {
    return 'cloudformation-stack-stuck';
  }

  get hygieneReason(): string {
    return `stuck in ${this.status}`;
  }

  get severity(): DeadResourceSeverity {
    return 'critical';
  }
}
