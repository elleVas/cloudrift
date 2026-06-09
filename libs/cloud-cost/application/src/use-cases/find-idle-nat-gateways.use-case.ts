import { Result } from 'shared-kernel';
import type { NatGateway, NatGatewayRepositoryPort, AwsRegion } from 'cloud-cost-domain';

export class FindIdleNatGatewaysUseCase {
  constructor(private readonly natGatewayRepository: NatGatewayRepositoryPort) {}

  async execute(regions: AwsRegion[]): Promise<Result<NatGateway[]>> {
    const allGateways: NatGateway[] = [];

    for (const region of regions) {
      const result = await this.natGatewayRepository.findIdleGateways(region);
      if (!result.ok) return result;
      allGateways.push(...result.value);
    }

    return Result.ok(allGateways);
  }
}
