// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2SecurityGroupOpenIngress } from './ec2-security-group-open-ingress.entity';
import type { Ec2SecurityGroupOpenIngressProps } from './ec2-security-group-open-ingress.entity';

function makeFinding(overrides: Partial<Ec2SecurityGroupOpenIngressProps> = {}): Ec2SecurityGroupOpenIngress {
  return new Ec2SecurityGroupOpenIngress({
    groupId: 'sg-1',
    groupName: 'web',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    matchedRules: ['22/tcp from 0.0.0.0/0'],
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2SecurityGroupOpenIngress', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('sg-1');
    expect(finding.kind).toBe('ec2-security-group-open-ingress');
    expect(finding.severity).toBe('critical');
  });

  it('riskReason lists the matched rules', () => {
    expect(makeFinding().riskReason).toContain('22/tcp from 0.0.0.0/0');
  });

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-07-23');
    const region = AwsRegion.create('eu-west-1');
    const finding = makeFinding({
      groupName: 'db',
      region,
      accountId: '999999999999',
      matchedRules: ['3389/tcp from ::/0'],
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(finding.groupName).toBe('db');
    expect(finding.region).toBe(region);
    expect(finding.accountId).toBe('999999999999');
    expect(finding.matchedRules).toEqual(['3389/tcp from ::/0']);
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
  });
});
