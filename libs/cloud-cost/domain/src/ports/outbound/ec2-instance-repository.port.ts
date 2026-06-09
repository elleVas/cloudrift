import type { Result } from 'shared-kernel';
import type { Ec2Instance } from '../../entities/ec2-instance.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface Ec2InstanceRepositoryPort {
  findStoppedInstances(region: AwsRegion): Promise<Result<Ec2Instance[]>>;
}

export const EC2_INSTANCE_REPOSITORY_PORT = Symbol('Ec2InstanceRepositoryPort');
