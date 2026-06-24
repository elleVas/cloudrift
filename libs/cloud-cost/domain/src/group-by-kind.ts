// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_KINDS, type ResourceKind, type WastedResource } from './wasted-resource';
import type { EbsVolume } from './entities/ebs-volume.entity';
import type { ElasticIp } from './entities/elastic-ip.entity';
import type { RdsInstance } from './entities/rds-instance.entity';
import type { LoadBalancer } from './entities/load-balancer.entity';
import type { Ec2Instance } from './entities/ec2-instance.entity';
import type { EbsSnapshot } from './entities/ebs-snapshot.entity';
import type { NatGateway } from './entities/nat-gateway.entity';
import type { Gp2Volume } from './entities/gp2-volume.entity';
import type { IdleEbsVolume } from './entities/idle-ebs-volume.entity';
import type { UnderutilizedEc2Instance } from './entities/underutilized-ec2-instance.entity';
import type { RdsUnderutilizedInstance } from './entities/rds-underutilized-instance.entity';
import type { LogGroup } from './entities/log-group.entity';
import type { OrphanedEni } from './entities/orphaned-eni.entity';
import type { S3Bucket } from './entities/s3-bucket.entity';
import type { UnderutilizedLambdaFunction } from './entities/underutilized-lambda-function.entity';
import type { EfsFileSystem } from './entities/efs-file-system.entity';
import type { OverprovisionedDynamoDbTable } from './entities/overprovisioned-dynamodb-table.entity';
import type { IdleElastiCacheCluster } from './entities/idle-elasticache-cluster.entity';

/**
 * Map kind → concrete entity. Allows consumers (formatters, frontend)
 * to retrieve the specific type from the kind without manual casts.
 */
export interface ResourceKindMap {
  'ebs-volume': EbsVolume;
  'elastic-ip': ElasticIp;
  'rds-instance': RdsInstance;
  'load-balancer': LoadBalancer;
  'ec2-instance': Ec2Instance;
  'ebs-snapshot': EbsSnapshot;
  'nat-gateway': NatGateway;
  'ebs-gp2-upgrade': Gp2Volume;
  'ebs-idle': IdleEbsVolume;
  'ec2-underutilized': UnderutilizedEc2Instance;
  'rds-underutilized': RdsUnderutilizedInstance;
  'log-group': LogGroup;
  'eni-orphaned': OrphanedEni;
  's3-no-lifecycle': S3Bucket;
  'lambda-underutilized': UnderutilizedLambdaFunction;
  'efs-unused': EfsFileSystem;
  'dynamodb-overprovisioned': OverprovisionedDynamoDbTable;
  'elasticache-idle': IdleElastiCacheCluster;
}

export type FindingsByKind = {
  [K in ResourceKind]: ResourceKindMap[K][];
};

export function groupByKind(findings: readonly WastedResource[]): FindingsByKind {
  const grouped = Object.fromEntries(
    RESOURCE_KINDS.map((kind) => [kind, []]),
  ) as unknown as FindingsByKind;

  for (const finding of findings) {
    (grouped[finding.kind] as WastedResource[]).push(finding);
  }

  return grouped;
}
