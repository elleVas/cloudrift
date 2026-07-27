// SPDX-License-Identifier: Apache-2.0
import { SqsDlqAbandoned } from './sqs-dlq-abandoned.entity';
import type { SqsDlqAbandonedProps } from './sqs-dlq-abandoned.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeDlq(overrides: Partial<SqsDlqAbandonedProps> = {}): SqsDlqAbandoned {
  return new SqsDlqAbandoned({
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue-dlq',
    queueName: 'my-queue-dlq',
    approximateNumberOfMessages: 3,
    oldestMessageAgeSeconds: 86400 * 5,
    identifiedAsDlq: true,
    sourceQueueArn: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
    region,
    accountId: '123456789012',
    tags: {},
    ...overrides,
  });
}

describe('SqsDlqAbandoned', () => {
  it('exposes correct id and fields', () => {
    const dlq = makeDlq();
    expect(dlq.id).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/my-queue-dlq');
    expect(dlq.queueName).toBe('my-queue-dlq');
  });

  it('exposes kind', () => {
    expect(makeDlq().kind).toBe('sqs-dlq-abandoned');
  });

  it('wasteReason reports the oldest message age in whole days and the message count', () => {
    const dlq = makeDlq({ oldestMessageAgeSeconds: 86400 * 3, approximateNumberOfMessages: 7 });
    expect(dlq.wasteReason).toBe('oldest message 3d old, 7 message(s) unconsumed');
  });

  it('wasteReason floors partial days', () => {
    const dlq = makeDlq({ oldestMessageAgeSeconds: 86400 * 3 + 3600, approximateNumberOfMessages: 1 });
    expect(dlq.wasteReason).toBe('oldest message 3d old, 1 message(s) unconsumed');
  });

  it('costEstimate is always zero, described as a hygiene flag with no storage cost', () => {
    const dlq = makeDlq();
    expect(dlq.costEstimate.monthlyCostUsd).toBe(0);
    expect(dlq.costEstimate.description).toBe('Abandoned SQS DLQ (hygiene flag, no storage cost)');
  });

  it('detectedAt is derived from the oldest message age relative to now', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-09T00:00:00.000Z'));
    const dlq = makeDlq({ oldestMessageAgeSeconds: 3600 });
    expect(dlq.detectedAt).toEqual(new Date('2026-06-08T23:00:00.000Z'));
    jest.useRealTimers();
  });

  it('exposes the remaining props', () => {
    const dlq = makeDlq({
      region,
      accountId: '999999999999',
      approximateNumberOfMessages: 42,
      identifiedAsDlq: false,
      sourceQueueArn: undefined,
      tags: { env: 'prod' },
    });
    expect(dlq.region).toBe(region);
    expect(dlq.accountId).toBe('999999999999');
    expect(dlq.approximateNumberOfMessages).toBe(42);
    expect(dlq.identifiedAsDlq).toBe(false);
    expect(dlq.sourceQueueArn).toBeUndefined();
    expect(dlq.tags).toEqual({ env: 'prod' });
  });
});
