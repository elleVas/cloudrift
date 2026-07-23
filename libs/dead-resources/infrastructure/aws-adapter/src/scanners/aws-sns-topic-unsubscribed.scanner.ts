// SPDX-License-Identifier: Apache-2.0
import { SNSClient, ListTopicsCommand, ListSubscriptionsByTopicCommand, type Topic } from '@aws-sdk/client-sns';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { SnsTopicUnsubscribed, SnsTopicUnsubscribedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

/** Bounds the per-topic ListSubscriptionsByTopic fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const SUBSCRIPTION_LOOKUP_CONCURRENCY = 5;

type TopicWithArn = Topic & { TopicArn: string };

function topicNameFromArn(arn: string): string {
  return arn.split(':').pop() ?? arn;
}

/**
 * Detects SNS topics with zero subscriptions. `ListTopics` doesn't return
 * tags inline, so `tags` is always `{}`.
 */
export class AwsSnsTopicUnsubscribedScanner implements DeadResourceScannerPort {
  readonly kind = 'sns-topic-unsubscribed' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new SnsTopicUnsubscribedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new SNSClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawTopics = await paginate<Topic>(async (cursor) => {
        const r = await client.send(new ListTopicsCommand({ NextToken: cursor }));
        return { items: r.Topics ?? [], cursor: r.NextToken };
      });
      const validTopics = rawTopics.filter((t): t is TopicWithArn => !!t.TopicArn);

      const now = new Date();
      const candidates = await mapWithConcurrency(validTopics, SUBSCRIPTION_LOOKUP_CONCURRENCY, async (topic) => {
        const subscriptions = await paginate(async (cursor) => {
          const r = await client.send(new ListSubscriptionsByTopicCommand({ TopicArn: topic.TopicArn, NextToken: cursor }));
          return { items: r.Subscriptions ?? [], cursor: r.NextToken };
        });
        if (subscriptions.length > 0) return undefined;
        return new SnsTopicUnsubscribed({
          topicArn: topic.TopicArn,
          topicName: topicNameFromArn(topic.TopicArn),
          region,
          accountId: this.accountId,
          detectedAt: now,
          tags: {},
        });
      });

      const results = candidates
        .filter((t): t is SnsTopicUnsubscribed => t !== undefined)
        .filter((t) => this.policy.evaluate(t, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SNS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
