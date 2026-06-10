import { Result } from 'shared-kernel';
import type { EbsSnapshot, EbsSnapshotRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindOrphanEbsSnapshotsUseCase {
  constructor(private readonly snapshotRepository: EbsSnapshotRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<EbsSnapshot[]>> {
    const allSnapshots: EbsSnapshot[] = [];

    for (const region of regions) {
      const result = await this.snapshotRepository.findOrphanSnapshots(region);
      if (!result.ok) return result;
      allSnapshots.push(...result.value);
    }

    return Result.ok(allSnapshots);
  }
}
