// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface SnsTopicUnsubscribedProps {
  topicArn: string;
  topicName: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * SNS topic with zero subscriptions — nothing will ever receive whatever is
 * published to it. No `createdAt`: neither `ListTopics` nor
 * `GetTopicAttributes` expose a creation timestamp, so this kind's policy
 * skips the shared grace-period machinery, same reasoning as
 * `Ec2SecurityGroupUnused`. `ListTopics` doesn't return tags inline, so
 * `tags` is always `{}`.
 */
export class SnsTopicUnsubscribed extends Entity<string> implements DeadResource {
  private readonly props: Readonly<SnsTopicUnsubscribedProps>;

  constructor(props: SnsTopicUnsubscribedProps) {
    super(props.topicArn);
    this.props = this.deepFreeze({ ...props });
  }

  get topicName(): string {
    return this.props.topicName;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'sns-topic-unsubscribed' {
    return 'sns-topic-unsubscribed';
  }

  get hygieneReason(): string {
    return 'has no subscriptions';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
