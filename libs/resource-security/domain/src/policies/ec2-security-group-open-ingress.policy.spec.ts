// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2SecurityGroupOpenIngress } from '../entities/ec2-security-group-open-ingress.entity';
import type { Ec2SecurityGroupOpenIngressProps } from '../entities/ec2-security-group-open-ingress.entity';
import { Ec2SecurityGroupOpenIngressPolicy } from './ec2-security-group-open-ingress.policy';
import { DEFAULT_IGNORE_TAG } from './resource-security-policy';

function makeFinding(overrides: Partial<Ec2SecurityGroupOpenIngressProps> = {}): Ec2SecurityGroupOpenIngress {
  return new Ec2SecurityGroupOpenIngress({
    groupId: 'sg-1',
    groupName: 'web',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    matchedRules: ['22/tcp from 0.0.0.0/0'],
    detectedAt: new Date('2026-07-23'),
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('Ec2SecurityGroupOpenIngressPolicy', () => {
  const policy = new Ec2SecurityGroupOpenIngressPolicy();

  it('flags a security group with a matched open-ingress rule', () => {
    expect(policy.evaluate(makeFinding()).flagged).toBe(true);
  });

  it('does not flag a security group carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeFinding({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }));
    expect(verdict.flagged).toBe(false);
  });
});
