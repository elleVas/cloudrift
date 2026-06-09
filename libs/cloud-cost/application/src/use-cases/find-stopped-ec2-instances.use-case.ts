import { Result } from 'shared-kernel';
import type { Ec2Instance, Ec2InstanceRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindStoppedEc2InstancesUseCase {
  constructor(private readonly ec2Repository: Ec2InstanceRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<Ec2Instance[]>> {
    const allInstances: Ec2Instance[] = [];

    for (const region of regions) {
      const result = await this.ec2Repository.findStoppedInstances(region);
      if (!result.ok) return result;
      allInstances.push(...result.value);
    }

    return Result.ok(allInstances);
  }
}
