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
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  'ebs-volume': 'EBS Volumes',
  'elastic-ip': 'Elastic IPs',
  'rds-instance': 'RDS Instances',
  'load-balancer': 'Load Balancers',
  'ec2-instance': 'EC2 Instances',
  'ebs-snapshot': 'EBS Snapshots',
  'nat-gateway': 'NAT Gateways',
};

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
