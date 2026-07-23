// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SnsTopicUnsubscribed } from '../entities/sns-topic-unsubscribed.entity';
import type { SnsTopicUnsubscribedProps } from '../entities/sns-topic-unsubscribed.entity';
import { SnsTopicUnsubscribedPolicy } from './sns-topic-unsubscribed.policy';
import { DEFAULT_IGNORE_TAG } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const region = AwsRegion.create('us-east-1');

function makeTopic(overrides: Partial<SnsTopicUnsubscribedProps> = {}): SnsTopicUnsubscribed {
  return new SnsTopicUnsubscribed({
    topicArn: 'arn:aws:sns:us-east-1:123456789012:topic-1',
    topicName: 'topic-1',
    region,
    accountId: '123456789012',
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('SnsTopicUnsubscribedPolicy', () => {
  const policy = new SnsTopicUnsubscribedPolicy();

  it('flags an unsubscribed topic with no grace period to wait out', () => {
    const verdict = policy.evaluate(makeTopic(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('no subscriptions');
  });

  it('does not flag a topic carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeTopic({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
