// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, type HygieneVerdict } from './dead-resource-policy';
import type { SnsTopicUnsubscribed } from '../entities/sns-topic-unsubscribed.entity';

/**
 * No grace-period machinery: `SnsTopicUnsubscribed` has no `createdAt`
 * (neither `ListTopics` nor `GetTopicAttributes` expose one), same
 * reasoning as `Ec2SecurityGroupUnusedPolicy`.
 */
export class SnsTopicUnsubscribedPolicy extends DeadResourcePolicy<SnsTopicUnsubscribed> {
  protected judge(resource: SnsTopicUnsubscribed): HygieneVerdict {
    return flagged(resource.hygieneReason);
  }
}
