// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecurityKind, ResourceSecurityKindMap, SecurityFinding } from 'resource-security-domain';

/**
 * Presentation per resource-security kind. Mirrors `dead-resource-
 * presenters.ts`'s shape and exhaustive-switch dispatch (ADR-0059) — adding
 * a new `ResourceSecurityKind` forces (via the compiler) adding the
 * presenter here and a case in `rowFor`/`recommendFor` below.
 */
export interface ResourceSecurityPresenter<T extends SecurityFinding = SecurityFinding> {
  title: string;
  /** Column headers, severity excluded (added by the formatters as the last column). */
  head: string[];
  row(resource: T): string[];
  recommend(resource: T): string;
}

function day(date: Date): string {
  return date.toISOString().split('T')[0];
}

type PresenterMap = { [K in ResourceSecurityKind]: ResourceSecurityPresenter<ResourceSecurityKindMap[K]> };

export const presenters: PresenterMap = {
  // No Region column for account-wide/global-scope kinds (IAM, S3 bucket
  // listing, CloudTrail) — `region` is unset on these entities.
  'iam-root-mfa-disabled': {
    title: 'Root Account — MFA Disabled',
    head: ['Account ID'],
    row: (f) => [f.accountId],
    recommend: (f) => `Enable MFA on the root account (${f.accountId})`,
  },
  'iam-user-mfa-disabled': {
    title: 'IAM Users — MFA Disabled',
    head: ['User Name', 'ARN', 'Created'],
    row: (u) => [u.userName, u.arn, day(u.createdAt)],
    recommend: (u) => `Enable MFA for IAM user "${u.userName}" (${u.arn})`,
  },
  'iam-access-key-rotation-overdue': {
    title: 'IAM Access Keys — Rotation Overdue',
    head: ['Access Key ID', 'User Name', 'Created'],
    row: (k) => [k.id, k.userName, day(k.createdAt)],
    recommend: (k) => `Rotate access key ${k.id} for IAM user "${k.userName}" — ${k.riskReason}`,
  },
  'iam-root-access-key-active': {
    title: 'Root Account — Active Access Key',
    head: ['Account ID'],
    row: (f) => [f.accountId],
    recommend: (f) => `Delete the root account's access key(s) (${f.accountId}) — use IAM users/roles instead`,
  },
  'iam-password-policy-weak': {
    title: 'Account Password Policy — Weak or Missing',
    head: ['Account ID', 'Details'],
    row: (f) => [f.accountId, f.riskReason],
    recommend: (f) => `Tighten the account password policy — ${f.riskReason}`,
  },
  'ec2-security-group-open-ingress': {
    title: 'EC2 Security Groups — Open Ingress',
    head: ['Group ID', 'Group Name', 'Region', 'Matched Rules'],
    row: (sg) => [sg.id, sg.groupName, sg.region.code, sg.matchedRules.join(', ')],
    recommend: (sg) => `Restrict ingress on security group "${sg.groupName}" (${sg.id}) in ${sg.region.code} — ${sg.riskReason}`,
  },
  'ec2-default-security-group-permissive': {
    title: 'EC2 Default Security Groups — Permissive',
    head: ['Group ID', 'VPC ID', 'Region'],
    row: (sg) => [sg.id, sg.vpcId, sg.region.code],
    recommend: (sg) => `Empty the default security group (${sg.id}) in VPC ${sg.vpcId}, region ${sg.region.code} — ${sg.riskReason}`,
  },
  's3-bucket-public': {
    title: 'S3 Buckets — Public',
    head: ['Bucket Name', 'Exposed Via'],
    row: (b) => [b.bucketName, b.publicVia.join('; ')],
    recommend: (b) => `Remove public access from S3 bucket "${b.bucketName}" — ${b.riskReason}`,
  },
  'ec2-snapshot-public': {
    title: 'EC2 Snapshots — Public',
    head: ['Snapshot ID', 'Volume ID', 'Region'],
    row: (s) => [s.id, s.volumeId, s.region.code],
    recommend: (s) => `Remove public restore permissions from snapshot ${s.id} in ${s.region.code}`,
  },
  'ec2-volume-unencrypted': {
    title: 'EBS Volumes — Unencrypted',
    head: ['Volume ID', 'Region'],
    row: (v) => [v.id, v.region.code],
    recommend: (v) => `Migrate EBS volume ${v.id} in ${v.region.code} to an encrypted volume`,
  },
  'rds-instance-unencrypted': {
    title: 'RDS Instances — Unencrypted',
    head: ['DB Instance', 'Region'],
    row: (i) => [i.id, i.region.code],
    recommend: (i) => `Enable storage encryption for RDS instance "${i.id}" in ${i.region.code} (requires a snapshot/restore cycle)`,
  },
  's3-bucket-encryption-missing': {
    title: 'S3 Buckets — Default Encryption Missing',
    head: ['Bucket Name'],
    row: (b) => [b.bucketName],
    recommend: (b) => `Enable default encryption on S3 bucket "${b.bucketName}"`,
  },
  'rds-instance-publicly-accessible': {
    title: 'RDS Instances — Publicly Accessible',
    head: ['DB Instance', 'Region'],
    row: (i) => [i.id, i.region.code],
    recommend: (i) => `Disable public accessibility for RDS instance "${i.id}" in ${i.region.code}`,
  },
  'cloudtrail-not-multiregion': {
    title: 'CloudTrail — No Multi-Region Trail',
    head: ['Account ID'],
    row: (f) => [f.accountId],
    recommend: (f) => `Create or update a CloudTrail trail with multi-region logging enabled for account ${f.accountId}`,
  },
  // v2 (2026-07-31) — no Region column for the global-scope kinds below
  // (account-wide IAM/S3 checks); the regional ones show it like above.
  'guardduty-not-enabled': {
    title: 'GuardDuty — Not Enabled',
    head: ['Region'],
    row: (f) => [f.region.code],
    recommend: (f) => `Enable GuardDuty in ${f.region.code}`,
  },
  'config-not-enabled': {
    title: 'AWS Config — Not Enabled',
    head: ['Region'],
    row: (f) => [f.region.code],
    recommend: (f) => `Enable an actively-recording AWS Config recorder in ${f.region.code}`,
  },
  'security-hub-not-enabled': {
    title: 'Security Hub — Not Enabled',
    head: ['Region'],
    row: (f) => [f.region.code],
    recommend: (f) => `Enable Security Hub in ${f.region.code}`,
  },
  'vpc-flow-logs-disabled': {
    title: 'VPCs — Flow Logs Disabled',
    head: ['VPC ID', 'Region'],
    row: (v) => [v.vpcId, v.region.code],
    recommend: (v) => `Enable a VPC Flow Log for ${v.vpcId} in ${v.region.code}`,
  },
  'kms-key-rotation-disabled': {
    title: 'KMS Keys — Rotation Disabled',
    head: ['Key ID', 'Region'],
    row: (k) => [k.keyId, k.region.code],
    recommend: (k) => `Enable automatic key rotation for KMS key ${k.keyId} in ${k.region.code}`,
  },
  's3-account-public-access-block-disabled': {
    title: 'S3 — Account-Level Block Public Access Disabled',
    head: ['Account ID'],
    row: (f) => [f.accountId],
    recommend: (f) => `Fully enable account-level S3 Block Public Access for account ${f.accountId}`,
  },
  's3-bucket-versioning-disabled': {
    title: 'S3 Buckets — Versioning/MFA-Delete Disabled',
    head: ['Bucket Name', 'Issue'],
    row: (b) => [b.bucketName, b.riskReason],
    recommend: (b) => `Fix S3 bucket "${b.bucketName}" — ${b.riskReason}`,
  },
  'redshift-cluster-publicly-accessible': {
    title: 'Redshift Clusters — Publicly Accessible',
    head: ['Cluster ID', 'Region'],
    row: (c) => [c.clusterId, c.region.code],
    recommend: (c) => `Disable public accessibility for Redshift cluster "${c.clusterId}" in ${c.region.code}`,
  },
  'iam-user-policy-wildcard': {
    title: 'IAM Users — Wildcard Admin Policy',
    head: ['User Name', 'ARN', 'Policy'],
    row: (u) => [u.userName, u.arn, u.policyName],
    recommend: (u) => `Remove or scope down policy "${u.policyName}" on IAM user "${u.userName}" (${u.arn})`,
  },
  'acm-certificate-expiring': {
    title: 'ACM Certificates — Expiring Soon',
    head: ['Domain', 'Region', 'Status'],
    row: (c) => [c.domainName, c.region.code, c.riskReason],
    recommend: (c) => `Renew ACM certificate for "${c.domainName}" in ${c.region.code} — ${c.riskReason}`,
  },
  'lambda-function-policy-public': {
    title: 'Lambda Functions — Public Resource Policy',
    head: ['Function Name', 'Region'],
    row: (f) => [f.functionName, f.region.code],
    recommend: (f) => `Restrict the resource policy on Lambda function "${f.functionName}" in ${f.region.code} to specific principals`,
  },
  'sns-topic-policy-public': {
    title: 'SNS Topics — Public Access Policy',
    head: ['Topic ARN', 'Region'],
    row: (t) => [t.topicArn, t.region.code],
    recommend: (t) => `Restrict the access policy on SNS topic "${t.topicArn}" in ${t.region.code} to specific principals`,
  },
  'sqs-queue-policy-public': {
    title: 'SQS Queues — Public Access Policy',
    head: ['Queue URL', 'Region'],
    row: (q) => [q.queueUrl, q.region.code],
    recommend: (q) => `Restrict the access policy on SQS queue "${q.queueUrl}" in ${q.region.code} to specific principals`,
  },
  'ecr-repository-policy-public': {
    title: 'ECR Repositories — Public Resource Policy',
    head: ['Repository Name', 'Region'],
    row: (r) => [r.repositoryName, r.region.code],
    recommend: (r) => `Restrict the repository policy on ECR repository "${r.repositoryName}" in ${r.region.code} to specific principals`,
  },
  'secrets-manager-secret-policy-public': {
    title: 'Secrets Manager Secrets — Public Resource Policy',
    head: ['Secret Name', 'Region'],
    row: (s) => [s.secretName, s.region.code],
    recommend: (s) => `Restrict the resource policy on secret "${s.secretName}" in ${s.region.code} to specific principals`,
  },
};

export function presenterFor(kind: ResourceSecurityKind): Omit<ResourceSecurityPresenter, 'row' | 'recommend'> {
  return presenters[kind];
}

/** Exhaustive switch on `finding.kind` (ADR-0059) — a missing case fails the build. */
export function rowFor(finding: ResourceSecurityKindMap[ResourceSecurityKind]): string[] {
  switch (finding.kind) {
    case 'iam-root-mfa-disabled':
      return presenters['iam-root-mfa-disabled'].row(finding);
    case 'iam-user-mfa-disabled':
      return presenters['iam-user-mfa-disabled'].row(finding);
    case 'iam-access-key-rotation-overdue':
      return presenters['iam-access-key-rotation-overdue'].row(finding);
    case 'iam-root-access-key-active':
      return presenters['iam-root-access-key-active'].row(finding);
    case 'iam-password-policy-weak':
      return presenters['iam-password-policy-weak'].row(finding);
    case 'ec2-security-group-open-ingress':
      return presenters['ec2-security-group-open-ingress'].row(finding);
    case 'ec2-default-security-group-permissive':
      return presenters['ec2-default-security-group-permissive'].row(finding);
    case 's3-bucket-public':
      return presenters['s3-bucket-public'].row(finding);
    case 'ec2-snapshot-public':
      return presenters['ec2-snapshot-public'].row(finding);
    case 'ec2-volume-unencrypted':
      return presenters['ec2-volume-unencrypted'].row(finding);
    case 'rds-instance-unencrypted':
      return presenters['rds-instance-unencrypted'].row(finding);
    case 's3-bucket-encryption-missing':
      return presenters['s3-bucket-encryption-missing'].row(finding);
    case 'rds-instance-publicly-accessible':
      return presenters['rds-instance-publicly-accessible'].row(finding);
    case 'cloudtrail-not-multiregion':
      return presenters['cloudtrail-not-multiregion'].row(finding);
    case 'guardduty-not-enabled':
      return presenters['guardduty-not-enabled'].row(finding);
    case 'config-not-enabled':
      return presenters['config-not-enabled'].row(finding);
    case 'security-hub-not-enabled':
      return presenters['security-hub-not-enabled'].row(finding);
    case 'vpc-flow-logs-disabled':
      return presenters['vpc-flow-logs-disabled'].row(finding);
    case 'kms-key-rotation-disabled':
      return presenters['kms-key-rotation-disabled'].row(finding);
    case 's3-account-public-access-block-disabled':
      return presenters['s3-account-public-access-block-disabled'].row(finding);
    case 's3-bucket-versioning-disabled':
      return presenters['s3-bucket-versioning-disabled'].row(finding);
    case 'redshift-cluster-publicly-accessible':
      return presenters['redshift-cluster-publicly-accessible'].row(finding);
    case 'iam-user-policy-wildcard':
      return presenters['iam-user-policy-wildcard'].row(finding);
    case 'acm-certificate-expiring':
      return presenters['acm-certificate-expiring'].row(finding);
    case 'lambda-function-policy-public':
      return presenters['lambda-function-policy-public'].row(finding);
    case 'sns-topic-policy-public':
      return presenters['sns-topic-policy-public'].row(finding);
    case 'sqs-queue-policy-public':
      return presenters['sqs-queue-policy-public'].row(finding);
    case 'ecr-repository-policy-public':
      return presenters['ecr-repository-policy-public'].row(finding);
    case 'secrets-manager-secret-policy-public':
      return presenters['secrets-manager-secret-policy-public'].row(finding);
  }
}

export function recommendFor(finding: ResourceSecurityKindMap[ResourceSecurityKind]): string {
  switch (finding.kind) {
    case 'iam-root-mfa-disabled':
      return presenters['iam-root-mfa-disabled'].recommend(finding);
    case 'iam-user-mfa-disabled':
      return presenters['iam-user-mfa-disabled'].recommend(finding);
    case 'iam-access-key-rotation-overdue':
      return presenters['iam-access-key-rotation-overdue'].recommend(finding);
    case 'iam-root-access-key-active':
      return presenters['iam-root-access-key-active'].recommend(finding);
    case 'iam-password-policy-weak':
      return presenters['iam-password-policy-weak'].recommend(finding);
    case 'ec2-security-group-open-ingress':
      return presenters['ec2-security-group-open-ingress'].recommend(finding);
    case 'ec2-default-security-group-permissive':
      return presenters['ec2-default-security-group-permissive'].recommend(finding);
    case 's3-bucket-public':
      return presenters['s3-bucket-public'].recommend(finding);
    case 'ec2-snapshot-public':
      return presenters['ec2-snapshot-public'].recommend(finding);
    case 'ec2-volume-unencrypted':
      return presenters['ec2-volume-unencrypted'].recommend(finding);
    case 'rds-instance-unencrypted':
      return presenters['rds-instance-unencrypted'].recommend(finding);
    case 's3-bucket-encryption-missing':
      return presenters['s3-bucket-encryption-missing'].recommend(finding);
    case 'rds-instance-publicly-accessible':
      return presenters['rds-instance-publicly-accessible'].recommend(finding);
    case 'cloudtrail-not-multiregion':
      return presenters['cloudtrail-not-multiregion'].recommend(finding);
    case 'guardduty-not-enabled':
      return presenters['guardduty-not-enabled'].recommend(finding);
    case 'config-not-enabled':
      return presenters['config-not-enabled'].recommend(finding);
    case 'security-hub-not-enabled':
      return presenters['security-hub-not-enabled'].recommend(finding);
    case 'vpc-flow-logs-disabled':
      return presenters['vpc-flow-logs-disabled'].recommend(finding);
    case 'kms-key-rotation-disabled':
      return presenters['kms-key-rotation-disabled'].recommend(finding);
    case 's3-account-public-access-block-disabled':
      return presenters['s3-account-public-access-block-disabled'].recommend(finding);
    case 's3-bucket-versioning-disabled':
      return presenters['s3-bucket-versioning-disabled'].recommend(finding);
    case 'redshift-cluster-publicly-accessible':
      return presenters['redshift-cluster-publicly-accessible'].recommend(finding);
    case 'iam-user-policy-wildcard':
      return presenters['iam-user-policy-wildcard'].recommend(finding);
    case 'acm-certificate-expiring':
      return presenters['acm-certificate-expiring'].recommend(finding);
    case 'lambda-function-policy-public':
      return presenters['lambda-function-policy-public'].recommend(finding);
    case 'sns-topic-policy-public':
      return presenters['sns-topic-policy-public'].recommend(finding);
    case 'sqs-queue-policy-public':
      return presenters['sqs-queue-policy-public'].recommend(finding);
    case 'ecr-repository-policy-public':
      return presenters['ecr-repository-policy-public'].recommend(finding);
    case 'secrets-manager-secret-policy-public':
      return presenters['secrets-manager-secret-policy-public'].recommend(finding);
  }
}
