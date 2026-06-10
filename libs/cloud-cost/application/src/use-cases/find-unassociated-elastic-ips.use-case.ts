import { Result } from 'shared-kernel';
import type { ElasticIp, ElasticIpRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindUnassociatedElasticIpsUseCase {
  constructor(private readonly elasticIpRepository: ElasticIpRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<ElasticIp[]>> {
    const allIps: ElasticIp[] = [];

    for (const region of regions) {
      const result =
        await this.elasticIpRepository.findUnassociatedElasticIps(region);
      if (!result.ok) return result;
      allIps.push(...result.value);
    }

    return Result.ok(allIps);
  }
}
