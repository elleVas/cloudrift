import { Result } from 'shared-kernel';
import type { EbsVolume, EbsVolumeRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindUnattachedEbsVolumesUseCase {
  constructor(private readonly ebsRepository: EbsVolumeRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<EbsVolume[]>> {
    const allVolumes: EbsVolume[] = [];

    for (const region of regions) {
      const result = await this.ebsRepository.findUnattachedVolumes(region);
      if (!result.ok) return result;
      allVolumes.push(...result.value);
    }

    return Result.ok(allVolumes);
  }
}
