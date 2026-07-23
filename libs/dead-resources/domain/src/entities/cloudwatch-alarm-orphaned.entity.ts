// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface CloudwatchAlarmOrphanedProps {
  alarmArn: string;
  alarmName: string;
  region: AwsRegion;
  accountId: string;
  /** `AlarmConfigurationUpdatedTimestamp` — proxy for "how long has this been stuck", since `DescribeAlarms` has no creation timestamp. */
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * CloudWatch alarm stuck in `INSUFFICIENT_DATA` (the scanner's
 * `DescribeAlarmsCommand` `StateValue` filter) — usually a sign the metric's
 * underlying resource (an instance, a queue, a table) was deleted and
 * nothing ever cleaned up the alarm watching it. `DescribeAlarms` doesn't
 * return tags inline, so `tags` is always `{}`.
 */
export class CloudwatchAlarmOrphaned extends Entity<string> implements DeadResource {
  private readonly props: Readonly<CloudwatchAlarmOrphanedProps>;

  constructor(props: CloudwatchAlarmOrphanedProps) {
    super(props.alarmArn);
    this.props = this.deepFreeze({ ...props });
  }

  get alarmName(): string {
    return this.props.alarmName;
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

  get kind(): 'cloudwatch-alarm-orphaned' {
    return 'cloudwatch-alarm-orphaned';
  }

  get hygieneReason(): string {
    return 'state has been INSUFFICIENT_DATA since its last configuration update';
  }

  get severity(): DeadResourceSeverity {
    return 'warning';
  }
}
