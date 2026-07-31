// SPDX-License-Identifier: Apache-2.0
import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { AwsSqsQueuePolicyPublicScanner } from './aws-sqs-queue-policy-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-sqs');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SQSClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSqsQueuePolicyPublicScanner();
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue';

const publicPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 'SQS:SendMessage' }] });
const scopedPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'SQS:SendMessage' }] });

describe('AwsSqsQueuePolicyPublicScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sqs-queue-policy-public');
  });

  it('flags a queue with a public access policy', async () => {
    mockSend.mockResolvedValueOnce({ QueueUrls: [queueUrl] }).mockResolvedValueOnce({ Attributes: { Policy: publicPolicy } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a queue with a scoped access policy', async () => {
    mockSend.mockResolvedValueOnce({ QueueUrls: [queueUrl] }).mockResolvedValueOnce({ Attributes: { Policy: scopedPolicy } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a queue with no policy attribute at all', async () => {
    mockSend.mockResolvedValueOnce({ QueueUrls: [queueUrl] }).mockResolvedValueOnce({ Attributes: {} });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListQueuesCommand and GetQueueAttributesCommand', async () => {
    mockSend.mockResolvedValueOnce({ QueueUrls: [queueUrl] }).mockResolvedValueOnce({ Attributes: {} });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListQueuesCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetQueueAttributesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListQueues itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
