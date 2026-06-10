import type { Result } from 'shared-kernel';
import type { ElasticIp } from '../../entities/elastic-ip.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface ElasticIpRepositoryPort {
  findUnassociatedElasticIps(region: AwsRegion): Promise<Result<ElasticIp[]>>;
}

export const ELASTIC_IP_REPOSITORY_PORT = Symbol('ElasticIpRepositoryPort');
