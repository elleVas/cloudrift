// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SnsTopicPolicyPublic } from '../entities/sns-topic-policy-public.entity';
import { SnsTopicPolicyPublicPolicy } from './sns-topic-policy-public.policy';

const region = AwsRegion.create('us-east-1');

function makeFinding(tags: Record<string, string> = {}): SnsTopicPolicyPublic {
  return new SnsTopicPolicyPublic({ topicArn: 'arn:aws:sns:us-east-1:123456789012:my-topic', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags });
}

describe('SnsTopicPolicyPublicPolicy', () => {
  it('flags — the scanner only emits topics with a public access policy', () => {
    expect(new SnsTopicPolicyPublicPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    expect(new SnsTopicPolicyPublicPolicy().evaluate(makeFinding({ 'cloudrift:ignore': 'true' })).flagged).toBe(false);
  });
});
