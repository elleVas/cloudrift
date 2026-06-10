import { FindUnassociatedElasticIpsUseCase } from './find-unassociated-elastic-ips.use-case';
import { AwsRegion, ElasticIp, ElasticIpRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeEip(allocationId: string, region = 'us-east-1'): ElasticIp {
  return new ElasticIp({
    allocationId,
    publicIp: '1.2.3.4',
    region: AwsRegion.create(region),
    accountId: '123456789012',
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 3.6,
  });
}

function makeRepo(
  impl: ElasticIpRepositoryPort['findUnassociatedElasticIps'],
): ElasticIpRepositoryPort {
  return { findUnassociatedElasticIps: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindUnassociatedElasticIpsUseCase', () => {
  it('returns an empty list when no EIPs found', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const useCase = new FindUnassociatedElasticIpsUseCase(repo);

    const result = await useCase.execute([usEast1]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates EIPs across multiple regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeEip('eipalloc-' + region.code, region.code)]),
    );
    const useCase = new FindUnassociatedElasticIpsUseCase(repo);

    const result = await useCase.execute([usEast1, euWest1]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('propagates repository failure', async () => {
    const err = new Error('EC2 API error');
    const repo = makeRepo(async () => Result.fail(err));
    const useCase = new FindUnassociatedElasticIpsUseCase(repo);

    const result = await useCase.execute([usEast1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
  });

  it('stops on the first failing region', async () => {
    const calls: string[] = [];
    const repo = makeRepo(async (region) => {
      calls.push(region.code);
      if (region.code === 'us-east-1') return Result.fail(new Error('fail'));
      return Result.ok([]);
    });
    const useCase = new FindUnassociatedElasticIpsUseCase(repo);

    await useCase.execute([usEast1, euWest1]);

    expect(calls).toEqual(['us-east-1']);
  });
});
