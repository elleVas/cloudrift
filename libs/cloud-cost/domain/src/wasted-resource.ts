// SPDX-License-Identifier: Apache-2.0
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
  'redshift-idle-cluster',
  'opensearch-idle-domain',
  'msk-idle-cluster',
  'fsx-idle-filesystem',
  'documentdb-idle-instance',
  'neptune-idle-instance',
  'mq-idle-broker',
  'workspaces-idle',
  'vpn-connection-idle',
  'transit-gateway-idle-attachment',
  'kinesis-provisioned-idle-stream',
  'sqs-dlq-abandoned',
  'lambda-loggroup-orphaned',
  'aurora-serverless-overprovisioned',
  'sagemaker-notebook-idle',
  'sagemaker-endpoint-idle',
  'sagemaker-training-orphaned',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * Category of a finding:
 * - `waste`: money spent now, eliminable by deleting/detaching the resource.
 *   Contributes to the **total waste** (the headline and the CI gate).
 * - `optimization`: savings opportunity while keeping the resource (e.g. gp2→gp3,
 *   rightsizing). Shown separately, NOT in the waste total.
 */
export type FindingCategory = 'waste' | 'optimization';

export interface ResourceKindMeta {
  label: string;
  category: FindingCategory;
  /** The saving is a heuristic estimate (rightsizing) rather than a definite value. */
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
  'redshift-idle-cluster': { label: 'Redshift Clusters (idle)', category: 'waste', estimated: false },
  'opensearch-idle-domain': { label: 'OpenSearch Domains (idle)', category: 'waste', estimated: false },
  'msk-idle-cluster': { label: 'MSK Clusters (idle)', category: 'waste', estimated: false },
  'fsx-idle-filesystem': { label: 'FSx File Systems (idle)', category: 'waste', estimated: false },
  'documentdb-idle-instance': { label: 'DocumentDB Instances (idle)', category: 'waste', estimated: false },
  'neptune-idle-instance': { label: 'Neptune Instances (idle)', category: 'waste', estimated: false },
  'mq-idle-broker': { label: 'Amazon MQ Brokers (idle)', category: 'waste', estimated: false },
  'workspaces-idle': { label: 'WorkSpaces (idle, AlwaysOn)', category: 'waste', estimated: false },
  'vpn-connection-idle': { label: 'Site-to-Site VPN Connections (idle)', category: 'waste', estimated: false },
  'transit-gateway-idle-attachment': {
    label: 'Transit Gateway Attachments (idle)',
    category: 'waste',
    estimated: false,
  },
  'kinesis-provisioned-idle-stream': {
    label: 'Kinesis Streams (idle, Provisioned mode)',
    category: 'waste',
    estimated: false,
  },
  // Phase 6.1 (ADR-0065): serverless orphans vertical. $0 hygiene flag, same
  // rationale as 'eni-orphaned' — no direct AWS cost, but signals ignored errors.
  'sqs-dlq-abandoned': { label: 'SQS Dead Letter Queues (abandoned)', category: 'waste', estimated: false },
  'lambda-loggroup-orphaned': {
    label: 'CloudWatch Log Groups (orphaned Lambda)',
    category: 'waste',
    estimated: false,
  },
  // Phase 6.2: Aurora Serverless v2 vertical. The Min ACU floor is always
  // billed (730h/mo); lowering it is a definite saving, but the recommended
  // floor is a heuristic (peak + 20% margin), hence estimated.
  'aurora-serverless-overprovisioned': {
    label: 'Aurora Serverless v2 (overprovisioned Min ACU)',
    category: 'optimization',
    estimated: true,
  },
  // Phase 6.3 (ADR-0065): SageMaker vertical. Notebook/endpoint costs are
  // per-instance-type (requires --live-pricing); training-orphaned is a
  // namespace-hygiene flag priced via the static S3 storage estimate.
  'sagemaker-notebook-idle': { label: 'SageMaker Notebook Instances (idle)', category: 'waste', estimated: false },
  'sagemaker-endpoint-idle': { label: 'SageMaker Endpoints (idle)', category: 'waste', estimated: false },
  'sagemaker-training-orphaned': {
    label: 'SageMaker Models (orphaned, no endpoint)',
    category: 'optimization',
    estimated: true,
  },
};

/** Human-readable labels, derived from RESOURCE_KIND_META (single source). */
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
 * Common contract for every resource reported as waste.
 * It's the only type that crosses the inbound boundary: coordinator,
 * summary, and formatters depend only on this interface, never
 * on the concrete entities.
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
