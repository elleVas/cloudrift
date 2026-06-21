import type { AwsRegion } from './value-objects/aws-region.value-object';
import type { CostEstimate } from './value-objects/cost-estimate.value-object';

export const RESOURCE_KINDS = [
  'ebs-volume',
  'elastic-ip',
  'rds-instance',
  'load-balancer',
  'ec2-instance',
  'ebs-snapshot',
  'nat-gateway',
  'ebs-gp2-upgrade',
  'ebs-idle',
  'ec2-underutilized',
  'rds-underutilized',
  'log-group',
  'eni-orphaned',
  's3-no-lifecycle',
  'lambda-underutilized',
  'efs-unused',
  'dynamodb-overprovisioned',
  'elasticache-idle',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * Categoria di un finding:
 * - `waste`: denaro speso ora, eliminabile cancellando/staccando la risorsa.
 *   Contribuisce al **totale waste** (l'headline e il gate CI).
 * - `optimization`: opportunità di risparmio mantenendo la risorsa (es. gp2→gp3,
 *   rightsizing). Mostrata a parte, NON nel totale waste.
 */
export type FindingCategory = 'waste' | 'optimization';

export interface ResourceKindMeta {
  label: string;
  category: FindingCategory;
  /** Il risparmio è una stima euristica (rightsizing) anziché un valore certo. */
  estimated: boolean;
}

export const RESOURCE_KIND_META: Record<ResourceKind, ResourceKindMeta> = {
  'ebs-volume': { label: 'EBS Volumes', category: 'waste', estimated: false },
  'elastic-ip': { label: 'Elastic IPs', category: 'waste', estimated: false },
  'rds-instance': { label: 'RDS Instances', category: 'waste', estimated: false },
  'load-balancer': { label: 'Load Balancers', category: 'waste', estimated: false },
  'ec2-instance': { label: 'EC2 Instances', category: 'waste', estimated: false },
  'ebs-snapshot': { label: 'EBS Snapshots', category: 'waste', estimated: false },
  'nat-gateway': { label: 'NAT Gateways', category: 'waste', estimated: false },
  'ebs-gp2-upgrade': { label: 'EBS gp2→gp3 Upgrades', category: 'optimization', estimated: false },
  'ebs-idle': { label: 'EBS Volumes (idle)', category: 'waste', estimated: false },
  'ec2-underutilized': {
    label: 'EC2 Instances (underutilized)',
    category: 'optimization',
    estimated: true,
  },
  'rds-underutilized': {
    label: 'RDS Instances (underutilized)',
    category: 'optimization',
    estimated: true,
  },
  'log-group': { label: 'CloudWatch Log Groups', category: 'waste', estimated: false },
  'eni-orphaned': { label: 'Orphaned ENIs', category: 'waste', estimated: false },
  's3-no-lifecycle': { label: 'S3 Buckets (no lifecycle)', category: 'optimization', estimated: true },
  'lambda-underutilized': { label: 'Lambda Functions (underutilized)', category: 'optimization', estimated: false },
  'efs-unused': { label: 'EFS File Systems (unused)', category: 'waste', estimated: false },
  'dynamodb-overprovisioned': {
    label: 'DynamoDB Tables (overprovisioned)',
    category: 'optimization',
    estimated: true,
  },
  'elasticache-idle': { label: 'ElastiCache Clusters (idle)', category: 'waste', estimated: false },
};

/** Etichette leggibili, derivate da RESOURCE_KIND_META (unica fonte). */
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = Object.fromEntries(
  RESOURCE_KINDS.map((kind) => [kind, RESOURCE_KIND_META[kind].label]),
) as Record<ResourceKind, string>;

export function categoryOf(kind: ResourceKind): FindingCategory {
  return RESOURCE_KIND_META[kind].category;
}

export function isEstimated(kind: ResourceKind): boolean {
  return RESOURCE_KIND_META[kind].estimated;
}

/**
 * Contratto comune di ogni risorsa segnalata come spreco.
 * È l'unico tipo che attraversa il confine inbound: coordinatore,
 * summary e formatter dipendono solo da questa interfaccia, mai
 * dalle entità concrete.
 */
export interface WastedResource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly region: AwsRegion;
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  readonly costEstimate: CostEstimate;
  readonly wasteReason: string;
}
