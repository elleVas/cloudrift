// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface LogsLogGroupEmptyProps {
  arn: string;
  logGroupName: string;
  region: AwsRegion;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * CloudWatch log group that has never stored any events (`storedBytes ===
 * 0`). Identified by `arn` rather than `logGroupName`: log group names are
 * only unique within a region, and findings from every requested region are
 * merged into one flat list. `DescribeLogGroups` doesn't return tags inline
 * (would need a separate `ListTagsForResource` call per group), so `tags`
 * is always `{}` here.
 */
export class LogsLogGroupEmpty extends Entity<string> implements DeadResource {
  private readonly props: Readonly<LogsLogGroupEmptyProps>;

  constructor(props: LogsLogGroupEmptyProps) {
    super(props.arn);
    this.props = this.deepFreeze({ ...props });
  }

  get logGroupName(): string {
    return this.props.logGroupName;
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

  get kind(): 'logs-loggroup-empty' {
    return 'logs-loggroup-empty';
  }

  get hygieneReason(): string {
    return 'has never stored any events';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
