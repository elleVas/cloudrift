// SPDX-License-Identifier: Apache-2.0
import { SNSClient, ListTopicsCommand } from '@aws-sdk/client-sns';
import { AwsSnsTopicUnsubscribedScanner } from './aws-sns-topic-unsubscribed.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-sns');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SNSClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSnsTopicUnsubscribedScanner();

/** ListTopics -> (per topic) ListSubscriptionsByTopic, in that call order. */
function queueTopic(topicArn: string, subscriptions: unknown[]): void {
  mockSend.mockResolvedValueOnce({ Topics: [{ TopicArn: topicArn }] }).mockResolvedValueOnce({ Subscriptions: subscriptions });
}

describe('AwsSnsTopicUnsubscribedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sns-topic-unsubscribed');
  });

  it('flags a topic with zero subscriptions', async () => {
    queueTopic('arn:aws:sns:us-east-1:123:alerts', []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).toEqual(['arn:aws:sns:us-east-1:123:alerts']);
  });

  it('does not flag a topic with at least one subscription', async () => {
    queueTopic('arn:aws:sns:us-east-1:123:active', [{ SubscriptionArn: 'arn:aws:sns:us-east-1:123:active:sub-1' }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListTopicsCommand', async () => {
    mockSend.mockResolvedValueOnce({ Topics: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListTopicsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
