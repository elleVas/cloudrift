// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2SecurityGroupUnused } from './ec2-security-group-unused.entity';
import type { Ec2SecurityGroupUnusedProps } from './ec2-security-group-unused.entity';

function makeGroup(overrides: Partial<Ec2SecurityGroupUnusedProps> = {}): Ec2SecurityGroupUnused {
  return new Ec2SecurityGroupUnused({
    groupId: 'sg-0123456789abcdef0',
    groupName: 'legacy-app-sg',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2SecurityGroupUnused', () => {
  it('exposes correct id and fields', () => {
    const sg = makeGroup();
    expect(sg.id).toBe('sg-0123456789abcdef0');
    expect(sg.groupName).toBe('legacy-app-sg');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const sg = makeGroup();
    expect(sg.kind).toBe('ec2-security-group-unused');
    expect(sg.hygieneReason).toContain('not attached');
    expect(sg.severity).toBe('info');
  });

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('eu-west-1');
    const detectedAt = new Date('2026-07-23');
    const sg = makeGroup({ region, accountId: '999999999999', detectedAt, tags: { env: 'prod' } });
    expect(sg.region).toBe(region);
    expect(sg.accountId).toBe('999999999999');
    expect(sg.detectedAt).toBe(detectedAt);
    expect(sg.tags).toEqual({ env: 'prod' });
  });
});
