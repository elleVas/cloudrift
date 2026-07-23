// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2RiExpiringSoon } from './ec2-ri-expiring-soon.entity';
import type { Ec2RiExpiringSoonProps } from './ec2-ri-expiring-soon.entity';

const region = AwsRegion.create('eu-west-1');

function makeRi(overrides: Partial<Ec2RiExpiringSoonProps> = {}): Ec2RiExpiringSoon {
  return new Ec2RiExpiringSoon({
    reservedInstancesId: 'ri-0abc123',
    region,
    accountId: '123456789012',
    instanceType: 'm5.large',
    instanceCount: 2,
    end: new Date('2026-08-01T00:00:00Z'),
    detectedAt: new Date('2026-07-15'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2RiExpiringSoon', () => {
  it('exposes correct id and fields', () => {
    const ri = makeRi();
    expect(ri.id).toBe('ri-0abc123');
    expect(ri.instanceType).toBe('m5.large');
    expect(ri.instanceCount).toBe(2);
  });

  it('exposes kind, hygieneReason (with the end date) and severity', () => {
    const ri = makeRi();
    expect(ri.kind).toBe('ec2-ri-expiring-soon');
    expect(ri.hygieneReason).toBe('expires 2026-08-01');
    expect(ri.severity).toBe('warning');
  });
});
