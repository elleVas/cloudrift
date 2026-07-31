// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SqsQueuePolicyPublic } from '../entities/sqs-queue-policy-public.entity';
import { SqsQueuePolicyPublicPolicy } from './sqs-queue-policy-public.policy';

const region = AwsRegion.create('us-east-1');

function makeFinding(tags: Record<string, string> = {}): SqsQueuePolicyPublic {
  return new SqsQueuePolicyPublic({ queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags });
}

describe('SqsQueuePolicyPublicPolicy', () => {
  it('flags — the scanner only emits queues with a public access policy', () => {
    expect(new SqsQueuePolicyPublicPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    expect(new SqsQueuePolicyPublicPolicy().evaluate(makeFinding({ 'cloudrift:ignore': 'true' })).flagged).toBe(false);
  });
});
