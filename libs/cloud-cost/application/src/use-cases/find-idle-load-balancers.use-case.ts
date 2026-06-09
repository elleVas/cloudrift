import { Result } from 'shared-kernel';
import type { LoadBalancer, LoadBalancerRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindIdleLoadBalancersUseCase {
  constructor(private readonly loadBalancerRepository: LoadBalancerRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<LoadBalancer[]>> {
    const allLoadBalancers: LoadBalancer[] = [];

    for (const region of regions) {
      const result = await this.loadBalancerRepository.findIdleLoadBalancers(region);
      if (!result.ok) return result;
      allLoadBalancers.push(...result.value);
    }

    return Result.ok(allLoadBalancers);
  }
}
