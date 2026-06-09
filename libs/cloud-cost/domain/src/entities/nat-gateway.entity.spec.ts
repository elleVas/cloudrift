import { NatGateway } from './nat-gateway.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

const gateway = new NatGateway({
  natGatewayId: 'nat-0abc123def456',
  region,
  accountId: '123456789012',
  vpcId: 'vpc-0123456789',
  createTime: new Date('2024-03-01'),
  detectedAt: new Date('2026-06-09'),
  tags: { Env: 'dev' },
  monthlyCostUsd: 36.72,
});

describe('NatGateway', () => {
  it('exposes correct id and fields', () => {
    expect(gateway.id).toBe('nat-0abc123def456');
    expect(gateway.vpcId).toBe('vpc-0123456789');
    expect(gateway.tags).toEqual({ Env: 'dev' });
  });

  it('costEstimate returns stored monthlyCostUsd', () => {
    expect(gateway.costEstimate.monthlyCostUsd).toBe(36.72);
  });

  it('costEstimate description references NAT Gateway', () => {
    expect(gateway.costEstimate.description).toContain('NAT Gateway');
  });
});
