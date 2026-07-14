// SPDX-License-Identifier: Apache-2.0
import { SQSClient } from '@aws-sdk/client-sqs';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsSqsDlqAbandonedScanner, DLQ_NAME_PATTERN } from './aws-sqs-dlq-abandoned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-sqs');
jest.mock('@aws-sdk/client-cloudwatch');

const mockSqsSend = jest.fn();
const mockSqsDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

interface QueueFixture {
  url: string;
  attributes?: Record<string, string>;
  sourceQueueUrls?: string[];
  tags?: Record<string, string>;
}

/**
 * Queues down the SQS responses for a single-queue scenario, in the exact
 * order `listResources` issues them: ListQueues, then — per queue, kicked
 * off together via `Promise.all` — GetQueueAttributes, ListDeadLetterSourceQueues.
 * ListQueueTags is queued too, but only when the fixture actually reaches it
 * (the scanner defers that call until after the DLQ-identification check) —
 * queuing it unconditionally would leave an unconsumed response sitting in
 * `mockSqsSend`'s queue, silently shifting every later test's alignment.
 * Automocked SDK Command instances don't retain `.input` (only the mock
 * constructor's captured call args do), so dispatching by command type
 * inside `send` isn't an option here — sequential mocking, like every other
 * scanner spec in this suite, is.
 */
function mockQueue(url: string, fixture: Omit<QueueFixture, 'url'> = {}): void {
  const queueName = url.slice(url.lastIndexOf('/') + 1);
  const isDlqCandidate =
    !!fixture.attributes?.RedriveAllowPolicy ||
    (fixture.sourceQueueUrls?.length ?? 0) > 0 ||
    DLQ_NAME_PATTERN.test(queueName);

  mockSqsSend
    .mockResolvedValueOnce({ QueueUrls: [url] })
    .mockResolvedValueOnce({ Attributes: fixture.attributes ?? {} })
    .mockResolvedValueOnce({ queueUrls: fixture.sourceQueueUrls ?? [] });
  if (isDlqCandidate) {
    mockSqsSend.mockResolvedValueOnce({ Tags: fixture.tags ?? {} });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  (SQSClient as jest.Mock).mockImplementation(() => ({ send: mockSqsSend, destroy: mockSqsDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSqsDlqAbandonedScanner();
const FOURTEEN_DAYS_SECONDS = 15 * 86400;

describe('AwsSqsDlqAbandonedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sqs-dlq-abandoned');
  });

  it('reports a DLQ identified via RedriveAllowPolicy with a stale oldest message', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/orders-dlq-target', {
      attributes: { RedriveAllowPolicy: '{"redrivePermission":"allowAll"}', ApproximateNumberOfMessages: '3' },
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: FOURTEEN_DAYS_SECONDS }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((q) => q.id)).toEqual(['https://sqs.us-east-1.amazonaws.com/000000000000/orders-dlq-target']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBe(0);
  });

  it('reports a DLQ identified via an active RedrivePolicy association and derives sourceQueueArn', async () => {
    const scannerWithAccount = new AwsSqsDlqAbandonedScanner('000000000000');
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/my-dead-letters', {
      attributes: { ApproximateNumberOfMessages: '5' },
      sourceQueueUrls: ['https://sqs.us-east-1.amazonaws.com/000000000000/orders-worker'],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: FOURTEEN_DAYS_SECONDS }] });

    const result = await scannerWithAccount.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].sourceQueueArn).toBe('arn:aws:sqs:us-east-1:000000000000:orders-worker');
  });

  it('omits sourceQueueArn (rather than a malformed pseudo-ARN) when the account ID could not be resolved', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/my-dead-letters', {
      attributes: { ApproximateNumberOfMessages: '5' },
      sourceQueueUrls: ['https://sqs.us-east-1.amazonaws.com/000000000000/orders-worker'],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: FOURTEEN_DAYS_SECONDS }] });

    const result = await scanner.scan(region); // default scanner: accountId = 'unknown'

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].sourceQueueArn).toBeUndefined();
  });

  it('reports a DLQ identified only via naming convention (source already decommissioned)', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/payments-dlq', {
      attributes: { ApproximateNumberOfMessages: '1' },
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: FOURTEEN_DAYS_SECONDS }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not report a queue with none of the three DLQ signals', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/orders-worker', {
      attributes: { ApproximateNumberOfMessages: '5' },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('does not report an identified DLQ with zero messages', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/idle-dlq', {
      attributes: { RedriveAllowPolicy: '{}', ApproximateNumberOfMessages: '0' },
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: FOURTEEN_DAYS_SECONDS }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a DLQ whose oldest message is within the grace period', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/fresh-dlq', {
      attributes: { RedriveAllowPolicy: '{}', ApproximateNumberOfMessages: '2' },
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: 3 * 86400 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('queries ApproximateAgeOfOldestMessage from the AWS/SQS namespace', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/orders-dlq', {
      attributes: { ApproximateNumberOfMessages: '1' },
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: FOURTEEN_DAYS_SECONDS }] });

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/SQS');
    expect(args.MetricName).toBe('ApproximateAgeOfOldestMessage');
    expect(args.Dimensions).toEqual([{ Name: 'QueueName', Value: 'orders-dlq' }]);
  });

  it('skips CloudWatch entirely when no queue matches a DLQ signal', async () => {
    mockQueue('https://sqs.us-east-1.amazonaws.com/000000000000/plain-queue', { attributes: {} });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockSqsSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('SQS');
    expect(mockSqsDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
