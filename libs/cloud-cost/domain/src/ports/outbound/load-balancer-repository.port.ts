import type { Result } from 'shared-kernel';
import type { LoadBalancer } from '../../entities/load-balancer.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface LoadBalancerRepositoryPort {
  findIdleLoadBalancers(region: AwsRegion): Promise<Result<LoadBalancer[]>>;
}

export const LOAD_BALANCER_REPOSITORY_PORT = Symbol('LoadBalancerRepositoryPort');
