// SPDX-License-Identifier: Apache-2.0
import { ElasticIp } from './elastic-ip.entity';
import type { ElasticIpProps } from './elastic-ip.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeEip(overrides: Partial<ElasticIpProps> = {}): ElasticIp {
  return new ElasticIp({
    allocationId: 'eipalloc-0abc123',
    publicIp: '203.0.113.10',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 3.6,
    ...overrides,
  });
}

describe('ElasticIp', () => {
  it('exposes correct id and fields', () => {
    const eip = makeEip();
    expect(eip.id).toBe('eipalloc-0abc123');
    expect(eip.publicIp).toBe('203.0.113.10');
    expect(eip.tags).toEqual({ Env: 'dev' });
  });

  it('isUnassociated returns true when there is no associationId', () => {
    expect(makeEip({ associationId: undefined }).isUnassociated()).toBe(true);
  });

  it('isUnassociated returns false when associated', () => {
    expect(makeEip({ associationId: 'eipassoc-123' }).isUnassociated()).toBe(false);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeEip().kind).toBe('elastic-ip');
    expect(makeEip().wasteReason).toContain('unassociated');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeEip().costEstimate.monthlyCostUsd).toBe(3.6);
  });

  it('costEstimate description references the unassociated Elastic IP', () => {
    expect(makeEip().costEstimate.description).toContain('Elastic IP');
  });
});
