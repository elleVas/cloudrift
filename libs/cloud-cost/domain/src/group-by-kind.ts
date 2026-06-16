import { RESOURCE_KINDS, type ResourceKind, type WastedResource } from './wasted-resource';
import type { EbsVolume } from './entities/ebs-volume.entity';
import type { ElasticIp } from './entities/elastic-ip.entity';
import type { RdsInstance } from './entities/rds-instance.entity';
import type { LoadBalancer } from './entities/load-balancer.entity';
import type { Ec2Instance } from './entities/ec2-instance.entity';
import type { EbsSnapshot } from './entities/ebs-snapshot.entity';
import type { NatGateway } from './entities/nat-gateway.entity';
import type { Gp2Volume } from './entities/gp2-volume.entity';

/**
 * Mappa kind → entità concreta. Permette ai consumer (formatter, frontend)
 * di recuperare il tipo specifico a partire dal kind senza cast manuali.
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
