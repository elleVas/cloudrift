// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SqsQueuePolicyPublic } from './sqs-queue-policy-public.entity';
import type { SqsQueuePolicyPublicProps } from './sqs-queue-policy-public.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<SqsQueuePolicyPublicProps> = {}): SqsQueuePolicyPublic {
  return new SqsQueuePolicyPublic({
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('SqsQueuePolicyPublic', () => {
  it('exposes id (queueUrl), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/my-queue');
    expect(finding.kind).toBe('sqs-queue-policy-public');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('any AWS principal');
  });
});
