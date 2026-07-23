// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2DefaultSecurityGroupPermissive } from './ec2-default-security-group-permissive.entity';
import type { Ec2DefaultSecurityGroupPermissiveProps } from './ec2-default-security-group-permissive.entity';

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

describe('Ec2DefaultSecurityGroupPermissive', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('sg-default-1');
    expect(finding.kind).toBe('ec2-default-security-group-permissive');
    expect(finding.severity).toBe('warning');
  });

  it('riskReason reports which rule types are present', () => {
    expect(makeFinding({ hasIngressRules: true, hasEgressRules: false }).riskReason).toContain('ingress rules present');
  });
});
