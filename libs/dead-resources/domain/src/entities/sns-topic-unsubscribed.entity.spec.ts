// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SnsTopicUnsubscribed } from './sns-topic-unsubscribed.entity';
import type { SnsTopicUnsubscribedProps } from './sns-topic-unsubscribed.entity';

function makeTopic(overrides: Partial<SnsTopicUnsubscribedProps> = {}): SnsTopicUnsubscribed {
  return new SnsTopicUnsubscribed({
    topicArn: 'arn:aws:sns:us-east-1:123456789012:alerts',
    topicName: 'alerts',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('SnsTopicUnsubscribed', () => {
  it('exposes correct id and fields', () => {
    const topic = makeTopic();
    expect(topic.id).toBe('arn:aws:sns:us-east-1:123456789012:alerts');
    expect(topic.topicName).toBe('alerts');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const topic = makeTopic();
    expect(topic.kind).toBe('sns-topic-unsubscribed');
    expect(topic.hygieneReason).toContain('no subscriptions');
    expect(topic.severity).toBe('info');
  });
});
