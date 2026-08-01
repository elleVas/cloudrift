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
  'environment-ghost',
  'eks-node-overprovisioned',
  'eks-orphan-pvc',
  'ami-unused',
  'ecr-image-untagged',
  's3-multipart-upload-abandoned',
  'rds-manual-snapshot-old',
  'secretsmanager-unused',
  'codepipeline-pipeline-stale',
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

/**
 * How defensible a finding's `monthlyCostUsd` is, independent of `category`
 * (which drives the CI gate) — this drives *display*, not gating:
 * - `measured`: a real AWS price × an observed quantity (an unattached
 *   volume's GB, an idle NAT gateway's fixed hourly rate). This is every
 *   `category: 'waste'` kind — that category's whole definition is "money
 *   spent now, at a real price", so the two always coincide.
 * - `derived`: a real price *difference* between two real prices (gp2→gp3,
 *   a rightsizing step-down, a DynamoDB/Aurora/EKS downsize) — not a blind
 *   percentage of the bill, but still `category: 'optimization'` (advisory,
 *   not gated) because the recommendation itself needs verifying.
 * - `heuristic`: no real basis for a dollar figure at all (e.g. S3 lifecycle
 *   savings depend on an object-age distribution cloudrift doesn't have).
 *   These kinds report `monthlyCostUsd: 0` by construction — see each
 *   entity's doc for why a number would be worse than none.
 */
export type FindingConfidence = 'measured' | 'derived' | 'heuristic';

/**
 * The `optimization`-category kinds whose saving is a real price
 * subtraction (`derived`), not a heuristic. Every other `optimization` kind
 * is `heuristic` (and reports $0 — see `FindingConfidence` doc). Kept as an
 * explicit list rather than a per-kind meta field: only 9 of 44 kinds are
 * `optimization` at all, so one well-commented exception list is easier to
 * keep honest than a 44-entry field where 35 entries would all just repeat
 * "measured".
 */
const DERIVED_OPTIMIZATION_KINDS = new Set<ResourceKind>([
  'ebs-gp2-upgrade', // real gp2 vs gp3 $/GB difference
  'ec2-underutilized', // real one-size-down instance price difference
  'rds-underutilized', // real one-size-down instance class price difference
  'dynamodb-overprovisioned', // real RCU/WCU price difference (current vs. avg-usage-derived recommendation)
  'aurora-serverless-overprovisioned', // real ACU-hour price × (current Min ACU − peak-derived recommendation)
  'eks-node-overprovisioned', // real per-instance-type price × (current − usage-derived node count)
]);

/**
 * How much work remediating a finding of this kind takes, independent of its
 * dollar cost — see docs/en/remediation-effort.md for the full per-kind
 * rationale. Feeds the PDF "quick wins" ranking (ADR-0093): a cheap-to-fix
 * finding should outrank an expensive one that needs a maintenance window.
 * - `low`: pure delete/detach of a resource nothing else references, no
 *   dependents by construction, reversible or near-zero risk.
 * - `medium`: needs verification before acting (the scan's "idle"/"unused"
 *   call could be wrong), or is an in-place config change with no downtime
 *   but some secondary effect.
 * - `high`: needs downtime, data migration, or coordination with another
 *   team/service that may depend on the resource silently.
 */
export type RemediationEffort = 'low' | 'medium' | 'high';

export interface ResourceKindMeta {
  label: string;
  category: FindingCategory;
  /** The saving is a heuristic estimate (rightsizing) rather than a definite value. */
  estimated: boolean;
  effort: RemediationEffort;
}

export const RESOURCE_KIND_META: Record<ResourceKind, ResourceKindMeta> = {
  'ebs-volume': { label: 'EBS Volumes', category: 'waste', estimated: false, effort: 'low' },
  'elastic-ip': { label: 'Elastic IPs', category: 'waste', estimated: false, effort: 'low' },
  'rds-instance': { label: 'RDS Instances', category: 'waste', estimated: false, effort: 'high' },
  'load-balancer': { label: 'Load Balancers', category: 'waste', estimated: false, effort: 'medium' },
  'ec2-instance': { label: 'EC2 Instances', category: 'waste', estimated: false, effort: 'medium' },
  'ebs-snapshot': { label: 'EBS Snapshots', category: 'waste', estimated: false, effort: 'low' },
  'nat-gateway': { label: 'NAT Gateways', category: 'waste', estimated: false, effort: 'medium' },
  'ebs-gp2-upgrade': { label: 'EBS gp2→gp3 Upgrades', category: 'optimization', estimated: false, effort: 'low' },
  'ebs-idle': { label: 'EBS Volumes (idle)', category: 'waste', estimated: false, effort: 'low' },
  'ec2-underutilized': {
    label: 'EC2 Instances (underutilized)',
    category: 'optimization',
    estimated: true,
    effort: 'medium',
  },
  'rds-underutilized': {
    label: 'RDS Instances (underutilized)',
    category: 'optimization',
    estimated: true,
    effort: 'high',
  },
  'log-group': { label: 'CloudWatch Log Groups', category: 'waste', estimated: false, effort: 'low' },
  'eni-orphaned': { label: 'Orphaned ENIs', category: 'waste', estimated: false, effort: 'low' },
  's3-no-lifecycle': { label: 'S3 Buckets (no lifecycle)', category: 'optimization', estimated: true, effort: 'low' },
  'lambda-underutilized': {
    label: 'Lambda Functions (underutilized)',
    category: 'optimization',
    estimated: false,
    effort: 'low',
  },
  'efs-unused': { label: 'EFS File Systems (unused)', category: 'waste', estimated: false, effort: 'medium' },
  'dynamodb-overprovisioned': {
    label: 'DynamoDB Tables (overprovisioned)',
    category: 'optimization',
    estimated: true,
    effort: 'low',
  },
  'elasticache-idle': { label: 'ElastiCache Clusters (idle)', category: 'waste', estimated: false, effort: 'medium' },
  'redshift-idle-cluster': { label: 'Redshift Clusters (idle)', category: 'waste', estimated: false, effort: 'high' },
  'opensearch-idle-domain': {
    label: 'OpenSearch Domains (idle)',
    category: 'waste',
    estimated: false,
    effort: 'medium',
  },
  'msk-idle-cluster': { label: 'MSK Clusters (idle)', category: 'waste', estimated: false, effort: 'high' },
  'fsx-idle-filesystem': { label: 'FSx File Systems (idle)', category: 'waste', estimated: false, effort: 'medium' },
  'documentdb-idle-instance': {
    label: 'DocumentDB Instances (idle)',
    category: 'waste',
    estimated: false,
    effort: 'high',
  },
  'neptune-idle-instance': { label: 'Neptune Instances (idle)', category: 'waste', estimated: false, effort: 'high' },
  'mq-idle-broker': { label: 'Amazon MQ Brokers (idle)', category: 'waste', estimated: false, effort: 'medium' },
  'workspaces-idle': { label: 'WorkSpaces (idle, AlwaysOn)', category: 'waste', estimated: false, effort: 'low' },
  'vpn-connection-idle': {
    label: 'Site-to-Site VPN Connections (idle)',
    category: 'waste',
    estimated: false,
    effort: 'medium',
  },
  'transit-gateway-idle-attachment': {
    label: 'Transit Gateway Attachments (idle)',
    category: 'waste',
    estimated: false,
    effort: 'medium',
  },
  'kinesis-provisioned-idle-stream': {
    label: 'Kinesis Streams (idle, Provisioned mode)',
    category: 'waste',
    estimated: false,
    effort: 'medium',
  },
  // Phase 6.1 (ADR-0065): serverless orphans vertical. $0 hygiene flag, same
  // rationale as 'eni-orphaned' — no direct AWS cost, but signals ignored errors.
  'sqs-dlq-abandoned': {
    label: 'SQS Dead Letter Queues (abandoned)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  'lambda-loggroup-orphaned': {
    label: 'CloudWatch Log Groups (orphaned Lambda)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  // Phase 6.2: Aurora Serverless v2 vertical. The Min ACU floor is always
  // billed (730h/mo); lowering it is a definite saving, but the recommended
  // floor is a heuristic (peak + 20% margin), hence estimated.
  'aurora-serverless-overprovisioned': {
    label: 'Aurora Serverless v2 (overprovisioned Min ACU)',
    category: 'optimization',
    estimated: true,
    effort: 'medium',
  },
  // Phase 6.3 (ADR-0065): SageMaker vertical. Notebook/endpoint costs are
  // per-instance-type (requires --live-pricing); training-orphaned is a
  // namespace-hygiene flag priced via the static S3 storage estimate.
  'sagemaker-notebook-idle': {
    label: 'SageMaker Notebook Instances (idle)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  'sagemaker-endpoint-idle': {
    label: 'SageMaker Endpoints (idle)',
    category: 'waste',
    estimated: false,
    effort: 'high',
  },
  'sagemaker-training-orphaned': {
    label: 'SageMaker Models (orphaned, no endpoint)',
    category: 'optimization',
    estimated: true,
    effort: 'low',
  },
  // Phase 6.4 (ADR-0065): Dev/PR ghost environments. $0 hygiene flag, same
  // rationale as 'eni-orphaned'/'sqs-dlq-abandoned' — no direct AWS cost,
  // signals a group of resources nobody tore down.
  'environment-ghost': {
    label: 'Dev/PR Environments (ghost, all resources inactive)',
    category: 'waste',
    estimated: false,
    effort: 'medium',
  },
  // Phase 6.5 (ADR-0065/ADR-0066): EKS cost visibility vertical. Per-instance-
  // type pricing (requires --live-pricing); the suggested node count is a
  // heuristic (Container Insights aggregate, not Pod-level), hence estimated.
  'eks-node-overprovisioned': {
    label: 'EKS Node Groups (overprovisioned)',
    category: 'optimization',
    estimated: true,
    effort: 'high',
  },
  // Phase 6.5 (ADR-0065/ADR-0066): EBS pricing is static, no --live-pricing gate.
  'eks-orphan-pvc': {
    label: 'EKS Orphaned PVC Volumes',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  // Added 2026-07-22: all fixed at-rest cost, always-on like the rest of
  // the EC2/S3/RDS scanners above.
  'ami-unused': {
    label: 'AMIs (unused, backing snapshots still billed)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  'ecr-image-untagged': { label: 'ECR Images (untagged)', category: 'waste', estimated: false, effort: 'low' },
  's3-multipart-upload-abandoned': {
    label: 'S3 Multipart Uploads (abandoned)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  'rds-manual-snapshot-old': {
    label: 'RDS Manual Snapshots (old)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
  'secretsmanager-unused': {
    label: 'Secrets Manager Secrets (unused)',
    category: 'waste',
    estimated: false,
    effort: 'medium',
  },
  // Added 2026-07-23: moved here from the dead-resources candidate list —
  // CodePipeline's flat $1/mo-per-pipeline fee is a real fixed at-rest cost
  // (ADR-0037 criteria), not a $0 hygiene flag, so it belongs with the rest
  // of the WastedResource scanners, always-on like ebs-snapshot.
  'codepipeline-pipeline-stale': {
    label: 'CodePipeline Pipelines (stale)',
    category: 'waste',
    estimated: false,
    effort: 'low',
  },
};

// Cast, not narrowed: `Object.fromEntries` always returns a plain
// `{[k: string]: T}`, discarding the fact that the entries were built from
// the exhaustive `RESOURCE_KINDS` list — same reasoning as `groupByKind`'s
// casts in `group-by-kind.ts`.
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

export function effortOf(kind: ResourceKind): RemediationEffort {
  return RESOURCE_KIND_META[kind].effort;
}

export function confidenceOf(kind: ResourceKind): FindingConfidence {
  if (RESOURCE_KIND_META[kind].category === 'waste') return 'measured';
  return DERIVED_OPTIMIZATION_KINDS.has(kind) ? 'derived' : 'heuristic';
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
