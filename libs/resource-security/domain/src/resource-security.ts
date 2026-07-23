// SPDX-License-Identifier: Apache-2.0
import type { AwsRegion } from 'cloud-cost-domain';

/**
 * One resource kind per security-posture check this domain covers: IAM/
 * account-level configuration, network exposure, public storage, encryption
 * at rest, and visibility/audit. Deliberately its own domain, not folded
 * into `dead-resources-domain` — these findings are not "dead" resources
 * (they're actively used, in-service resources with a risky configuration),
 * so `hygieneReason`/`DeadResource` would misdescribe them. Mirrors the
 * `dead-resources` vs `cloud-cost` split (ADR-0078) one level further.
 */
export const RESOURCE_SECURITY_KINDS = [
  'iam-root-mfa-disabled',
  'iam-user-mfa-disabled',
  'iam-access-key-rotation-overdue',
  'iam-root-access-key-active',
  'iam-password-policy-weak',
  'ec2-security-group-open-ingress',
  'ec2-default-security-group-permissive',
  's3-bucket-public',
  'ec2-snapshot-public',
  'ec2-volume-unencrypted',
  'rds-instance-unencrypted',
  's3-bucket-encryption-missing',
  'rds-instance-publicly-accessible',
  'cloudtrail-not-multiregion',
] as const;
export type ResourceSecurityKind = (typeof RESOURCE_SECURITY_KINDS)[number];

/** How urgent a finding is. Same three-level scale as `dead-resources-domain`'s `DeadResourceSeverity`. */
export type ResourceSecuritySeverity = 'info' | 'warning' | 'critical';

/** Whether a kind's scanner is called once per requested region, or exactly once (account-wide/global AWS services: IAM, S3 bucket listing, CloudTrail). */
export type ResourceSecurityScope = 'regional' | 'global';

export interface ResourceSecurityKindMeta {
  label: string;
  scope: ResourceSecurityScope;
}

export const RESOURCE_SECURITY_KIND_META: Record<ResourceSecurityKind, ResourceSecurityKindMeta> = {
  'iam-root-mfa-disabled': { label: 'Root Account (MFA disabled)', scope: 'global' },
  'iam-user-mfa-disabled': { label: 'IAM Users (MFA disabled)', scope: 'global' },
  'iam-access-key-rotation-overdue': { label: 'IAM Access Keys (rotation overdue)', scope: 'global' },
  'iam-root-access-key-active': { label: 'Root Account (active access key)', scope: 'global' },
  'iam-password-policy-weak': { label: 'Account Password Policy (weak or missing)', scope: 'global' },
  'ec2-security-group-open-ingress': { label: 'EC2 Security Groups (open ingress on sensitive ports)', scope: 'regional' },
  'ec2-default-security-group-permissive': { label: 'EC2 Default Security Groups (permissive)', scope: 'regional' },
  's3-bucket-public': { label: 'S3 Buckets (public)', scope: 'global' },
  'ec2-snapshot-public': { label: 'EC2 Snapshots (public)', scope: 'regional' },
  'ec2-volume-unencrypted': { label: 'EBS Volumes (unencrypted)', scope: 'regional' },
  'rds-instance-unencrypted': { label: 'RDS Instances (unencrypted)', scope: 'regional' },
  's3-bucket-encryption-missing': { label: 'S3 Buckets (default encryption missing)', scope: 'global' },
  'rds-instance-publicly-accessible': { label: 'RDS Instances (publicly accessible)', scope: 'regional' },
  'cloudtrail-not-multiregion': { label: 'CloudTrail (no multi-region trail)', scope: 'global' },
};

/**
 * The sole inbound-boundary type for this domain (mirrors `DeadResource` in
 * `dead-resources-domain`, itself mirroring `WastedResource`, ADR-0014):
 * coordinator, summary and formatters depend only on this interface, never
 * on the concrete entities.
 *
 * `region` is optional: global-scope kinds (IAM, S3 bucket listing,
 * CloudTrail) have no single region to report.
 */
export interface SecurityFinding {
  readonly id: string;
  readonly kind: ResourceSecurityKind;
  readonly region?: AwsRegion;
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  /** Why this was flagged — e.g. "no MFA device registered". */
  readonly riskReason: string;
  readonly severity: ResourceSecuritySeverity;
}
