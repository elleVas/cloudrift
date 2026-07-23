// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2DefaultSecurityGroupPermissive } from '../entities/ec2-default-security-group-permissive.entity';
import type { Ec2DefaultSecurityGroupPermissiveProps } from '../entities/ec2-default-security-group-permissive.entity';
import { Ec2DefaultSecurityGroupPermissivePolicy } from './ec2-default-security-group-permissive.policy';

function makeFinding(overrides: Partial<Ec2DefaultSecurityGroupPermissiveProps> = {}): Ec2DefaultSecurityGroupPermissive {
  return new Ec2DefaultSecurityGroupPermissive({
    groupId: 'sg-default-1',
    vpcId: 'vpc-1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    hasIngressRules: true,
    hasEgressRules: true,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2DefaultSecurityGroupPermissivePolicy', () => {
  const policy = new Ec2DefaultSecurityGroupPermissivePolicy();

  it('flags a default security group carrying rules', () => {
    expect(policy.evaluate(makeFinding()).flagged).toBe(true);
  });
});
