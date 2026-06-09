import type { Result } from 'shared-kernel';
import type { RdsInstance } from '../../entities/rds-instance.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface RdsInstanceRepositoryPort {
  findStoppedInstances(region: AwsRegion): Promise<Result<RdsInstance[]>>;
}

export const RDS_INSTANCE_REPOSITORY_PORT = Symbol('RdsInstanceRepositoryPort');
