import type { Result } from 'shared-kernel';
import type { EbsSnapshot } from '../../entities/ebs-snapshot.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface EbsSnapshotRepositoryPort {
  findOrphanSnapshots(region: AwsRegion): Promise<Result<EbsSnapshot[]>>;
}

export const EBS_SNAPSHOT_REPOSITORY_PORT = Symbol('EbsSnapshotRepositoryPort');
