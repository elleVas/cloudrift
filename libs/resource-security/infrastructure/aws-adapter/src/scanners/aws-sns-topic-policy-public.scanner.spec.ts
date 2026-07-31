// SPDX-License-Identifier: Apache-2.0
import { SNSClient, ListTopicsCommand, GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import { AwsSnsTopicPolicyPublicScanner } from './aws-sns-topic-policy-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-sns');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SNSClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSnsTopicPolicyPublicScanner();
const topic = { TopicArn: 'arn:aws:sns:us-east-1:123456789012:my-topic' };

const publicPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 'SNS:Publish' }] });
const scopedPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'SNS:Publish' }] });

describe('AwsSnsTopicPolicyPublicScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('sns-topic-policy-public');
  });

  it('flags a topic with a public access policy', async () => {
    mockSend.mockResolvedValueOnce({ Topics: [topic] }).mockResolvedValueOnce({ Attributes: { Policy: publicPolicy } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a topic with a scoped access policy', async () => {
    mockSend.mockResolvedValueOnce({ Topics: [topic] }).mockResolvedValueOnce({ Attributes: { Policy: scopedPolicy } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a topic after a per-topic error instead of failing the whole scan', async () => {
    mockSend.mockResolvedValueOnce({ Topics: [topic] }).mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListTopicsCommand and GetTopicAttributesCommand', async () => {
    mockSend.mockResolvedValueOnce({ Topics: [topic] }).mockResolvedValueOnce({ Attributes: { Policy: scopedPolicy } });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListTopicsCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetTopicAttributesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListTopics itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
