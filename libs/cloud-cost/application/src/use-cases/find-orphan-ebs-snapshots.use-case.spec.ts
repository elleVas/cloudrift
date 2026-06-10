import { FindOrphanEbsSnapshotsUseCase } from './find-orphan-ebs-snapshots.use-case';
import { AwsRegion, EbsSnapshot, EbsSnapshotRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeSnapshot(id: string, region = 'us-east-1'): EbsSnapshot {
  return new EbsSnapshot({
    snapshotId: id,
    region: AwsRegion.create(region),
    accountId: '123456789012',
    sourceVolumeId: 'vol-deleted',
    sizeGb: 50,
    startTime: new Date('2023-01-01'),
    detectedAt: new Date('2026-06-09'),
    description: 'test snapshot',
    tags: {},
    monthlyCostUsd: 2.5,
  });
}

function makeRepo(
  impl: EbsSnapshotRepositoryPort['findOrphanSnapshots'],
): EbsSnapshotRepositoryPort {
  return { findOrphanSnapshots: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindOrphanEbsSnapshotsUseCase', () => {
  it('returns empty list when no orphan snapshots', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const result = await new FindOrphanEbsSnapshotsUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates snapshots across regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeSnapshot('snap-' + region.code, region.code)]),
    );
    const result = await new FindOrphanEbsSnapshotsUseCase(repo).execute([usEast1, euWest1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('propagates repository failure', async () => {
    const err = new Error('EC2 API error');
    const repo = makeRepo(async () => Result.fail(err));
    const result = await new FindOrphanEbsSnapshotsUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
  });
});
