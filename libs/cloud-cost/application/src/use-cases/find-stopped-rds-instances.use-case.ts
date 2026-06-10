import { Result } from 'shared-kernel';
import type { RdsInstance, RdsInstanceRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindStoppedRdsInstancesUseCase {
  constructor(private readonly rdsRepository: RdsInstanceRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<RdsInstance[]>> {
    const allInstances: RdsInstance[] = [];

    for (const region of regions) {
      const result = await this.rdsRepository.findStoppedInstances(region);
      if (!result.ok) return result;
      allInstances.push(...result.value);
    }

    return Result.ok(allInstances);
  }
}
