import { FindUnattachedEbsVolumesUseCase } from './find-unattached-ebs-volumes.use-case';
import { AwsRegion, EbsVolume, EbsVolumeRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeVolume(id: string, region = 'us-east-1'): EbsVolume {
  return new EbsVolume({
    volumeId: id,
    region: AwsRegion.create(region),
    accountId: '123456789012',
    sizeGb: 50,
    volumeType: 'gp3',
    state: 'available',
    createTime: new Date('2025-06-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 4,
  });
}

function makeRepo(
  impl: EbsVolumeRepositoryPort['findUnattachedVolumes'],
): EbsVolumeRepositoryPort {
  return { findUnattachedVolumes: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindUnattachedEbsVolumesUseCase', () => {
  it('returns an empty list when no volumes found', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const useCase = new FindUnattachedEbsVolumesUseCase(repo);

    const result = await useCase.execute([usEast1]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates volumes across multiple regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeVolume('vol-' + region.code, region.code)]),
    );
    const useCase = new FindUnattachedEbsVolumesUseCase(repo);

    const result = await useCase.execute([usEast1, euWest1]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('short-circuits and returns the first failure', async () => {
    const err = new Error('EC2 unavailable');
    let callCount = 0;
    const repo = makeRepo(async () => {
      callCount++;
      return Result.fail(err);
    });
    const useCase = new FindUnattachedEbsVolumesUseCase(repo);

    const result = await useCase.execute([usEast1, euWest1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
    expect(callCount).toBe(1);
  });

  it('processes regions sequentially (second region called only if first succeeds)', async () => {
    const calls: string[] = [];
    const repo = makeRepo(async (region) => {
      calls.push(region.code);
      return Result.ok([]);
    });
    const useCase = new FindUnattachedEbsVolumesUseCase(repo);

    await useCase.execute([usEast1, euWest1]);

    expect(calls).toEqual(['us-east-1', 'eu-west-1']);
  });
});
