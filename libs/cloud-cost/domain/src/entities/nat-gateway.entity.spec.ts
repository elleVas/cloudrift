import { NatGateway } from './nat-gateway.entity';
import type { NatGatewayProps } from './nat-gateway.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeGateway(overrides: Partial<NatGatewayProps> = {}): NatGateway {
  return new NatGateway({
    natGatewayId: 'nat-0abc123def456',
    region,
    accountId: '123456789012',
    vpcId: 'vpc-0123456789',
    createTime: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    bytesOutLastWindow: 0,
    metricWindowHours: 48,
    tags: { Env: 'dev' },
    monthlyCostUsd: 36.72,
    ...overrides,
  });
}

describe('NatGateway', () => {
  it('exposes correct id and fields', () => {
    const gateway = makeGateway();
    expect(gateway.id).toBe('nat-0abc123def456');
    expect(gateway.vpcId).toBe('vpc-0123456789');
    expect(gateway.tags).toEqual({ Env: 'dev' });
  });

  it('isIdle returns true when no bytes were sent in the window', () => {
    expect(makeGateway({ bytesOutLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when traffic was observed', () => {
    expect(makeGateway({ bytesOutLastWindow: 1024 }).isIdle()).toBe(false);
  });

  it('wasteReason references the observation window', () => {
    expect(makeGateway().kind).toBe('nat-gateway');
    expect(makeGateway().wasteReason).toContain('48h');
  });

  it('costEstimate returns stored monthlyCostUsd', () => {
    expect(makeGateway().costEstimate.monthlyCostUsd).toBe(36.72);
  });

  it('costEstimate description references NAT Gateway', () => {
    expect(makeGateway().costEstimate.description).toContain('NAT Gateway');
  });
});
