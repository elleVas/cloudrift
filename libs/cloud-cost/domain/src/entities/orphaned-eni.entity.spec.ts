import { OrphanedEni } from './orphaned-eni.entity';
import type { OrphanedEniProps } from './orphaned-eni.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeEni(overrides: Partial<OrphanedEniProps> = {}): OrphanedEni {
  return new OrphanedEni({
    networkInterfaceId: 'eni-0abc123',
    region,
    accountId: '123456789012',
    vpcId: 'vpc-0123456789',
    subnetId: 'subnet-0123456789',
    status: 'available',
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    ...overrides,
  });
}

describe('OrphanedEni', () => {
  it('exposes correct id and fields', () => {
    const eni = makeEni();
    expect(eni.id).toBe('eni-0abc123');
    expect(eni.vpcId).toBe('vpc-0123456789');
    expect(eni.subnetId).toBe('subnet-0123456789');
    expect(eni.tags).toEqual({ Env: 'dev' });
  });

  it('isOrphaned returns true when status is available', () => {
    expect(makeEni({ status: 'available' }).isOrphaned()).toBe(true);
  });

  it('isOrphaned returns false when status is in-use', () => {
    expect(makeEni({ status: 'in-use' }).isOrphaned()).toBe(false);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeEni().kind).toBe('eni-orphaned');
    expect(makeEni().wasteReason).toContain('not attached');
  });

  it('costEstimate is zero (hygiene flag, no direct cost)', () => {
    expect(makeEni().costEstimate.monthlyCostUsd).toBe(0);
  });
});
