import { FindIdleNatGatewaysUseCase } from './find-idle-nat-gateways.use-case';
import { AwsRegion, NatGateway, NatGatewayRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeGateway(id: string, region = 'us-east-1'): NatGateway {
  return new NatGateway({
    natGatewayId: id,
    region: AwsRegion.create(region),
    accountId: '123456789012',
    vpcId: 'vpc-0123456789',
    createTime: new Date('2024-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 32.4,
  });
}

function makeRepo(
  impl: NatGatewayRepositoryPort['findIdleGateways'],
): NatGatewayRepositoryPort {
  return { findIdleGateways: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindIdleNatGatewaysUseCase', () => {
  it('returns empty list when no idle gateways', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const result = await new FindIdleNatGatewaysUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates gateways across regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeGateway('nat-' + region.code, region.code)]),
    );
    const result = await new FindIdleNatGatewaysUseCase(repo).execute([usEast1, euWest1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('propagates repository failure', async () => {
    const err = new Error('CloudWatch API error');
    const repo = makeRepo(async () => Result.fail(err));
    const result = await new FindIdleNatGatewaysUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
  });
});
