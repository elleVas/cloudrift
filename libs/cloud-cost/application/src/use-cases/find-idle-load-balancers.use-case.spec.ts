import { FindIdleLoadBalancersUseCase } from './find-idle-load-balancers.use-case';
import { AwsRegion, LoadBalancer, LoadBalancerRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeLb(arn: string, region = 'us-east-1'): LoadBalancer {
  return new LoadBalancer({
    arn,
    name: 'lb-' + arn,
    region: AwsRegion.create(region),
    accountId: '123456789012',
    type: 'application',
    createdTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 16.2,
  });
}

function makeRepo(
  impl: LoadBalancerRepositoryPort['findIdleLoadBalancers'],
): LoadBalancerRepositoryPort {
  return { findIdleLoadBalancers: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindIdleLoadBalancersUseCase', () => {
  it('returns empty list when no idle LBs', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const result = await new FindIdleLoadBalancersUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates LBs across regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeLb('arn:' + region.code, region.code)]),
    );
    const result = await new FindIdleLoadBalancersUseCase(repo).execute([usEast1, euWest1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('propagates repository failure', async () => {
    const err = new Error('ELB API error');
    const repo = makeRepo(async () => Result.fail(err));
    const result = await new FindIdleLoadBalancersUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
  });
});
