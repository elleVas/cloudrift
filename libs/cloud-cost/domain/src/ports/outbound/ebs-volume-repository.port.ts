import type { Result } from 'shared-kernel';
import type { EbsVolume } from '../../entities/ebs-volume.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface EbsVolumeRepositoryPort {
  findUnattachedVolumes(region: AwsRegion): Promise<Result<EbsVolume[]>>;
}

export const EBS_VOLUME_REPOSITORY_PORT = Symbol('EbsVolumeRepositoryPort');
