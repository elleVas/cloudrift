import type { Result } from 'shared-kernel';
import type { NatGateway } from '../../entities/nat-gateway.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface NatGatewayRepositoryPort {
  findIdleGateways(region: AwsRegion): Promise<Result<NatGateway[]>>;
}

export const NAT_GATEWAY_REPOSITORY_PORT = Symbol('NatGatewayRepositoryPort');
