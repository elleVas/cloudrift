// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SnsTopicPolicyPublic } from './sns-topic-policy-public.entity';
import type { SnsTopicPolicyPublicProps } from './sns-topic-policy-public.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<SnsTopicPolicyPublicProps> = {}): SnsTopicPolicyPublic {
  return new SnsTopicPolicyPublic({
    topicArn: 'arn:aws:sns:us-east-1:123456789012:my-topic',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('SnsTopicPolicyPublic', () => {
  it('exposes id (topicArn), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('arn:aws:sns:us-east-1:123456789012:my-topic');
    expect(finding.kind).toBe('sns-topic-policy-public');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('any AWS principal');
  });
});
