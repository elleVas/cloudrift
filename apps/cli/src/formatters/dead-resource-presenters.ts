// SPDX-License-Identifier: Apache-2.0
import type { DeadResourceKind, DeadResourceKindMap, DeadResource } from 'dead-resources-domain';

/**
 * Presentation per dead-resource kind. Mirrors `resource-presenters.ts`'s
 * shape and exhaustive-switch dispatch (ADR-0059) for the `WastedResource`
 * domain — same reasoning applies here: adding a new `DeadResourceKind`
 * forces (via the compiler) adding the presenter here and a case in
 * `rowFor`/`recommendFor` below.
 */
export interface DeadResourcePresenter<T extends DeadResource = DeadResource> {
  title: string;
  /** Column headers, severity excluded (added by the formatters as the last column). */
  head: string[];
  row(resource: T): string[];
  recommend(resource: T): string;
}

function day(date: Date): string {
  return date.toISOString().split('T')[0];
}

type PresenterMap = { [K in DeadResourceKind]: DeadResourcePresenter<DeadResourceKindMap[K]> };

export const presenters: PresenterMap = {
  'ec2-keypair-unused': {
    // Unlike WastedResource's opaque IDs (vol-…, i-…), a key pair's `KeyName`
    // is already the human-chosen label — no separate Name-tag column needed
    // (see ADR-0076 for why that pattern exists elsewhere).
    title: 'EC2 Key Pairs — Unused',
    head: ['Key Pair ID', 'Key Name', 'Region', 'Created'],
    row: (kp) => [kp.id, kp.keyName, kp.region.code, day(kp.createdAt)],
    recommend: (kp) => `Delete unused EC2 key pair "${kp.keyName}" (${kp.id}) in ${kp.region.code}`,
  },
  'ec2-ri-expiring-soon': {
    title: 'EC2 Reserved Instances — Expiring soon',
    head: ['Reserved Instance ID', 'Instance Type', 'Count', 'Region', 'Expires'],
    row: (ri) => [ri.id, ri.instanceType, String(ri.instanceCount), ri.region.code, day(ri.end)],
    recommend: (ri) =>
      `Decide whether to renew Reserved Instance ${ri.id} (${ri.instanceType} × ${ri.instanceCount}) in ${ri.region.code} — ${ri.hygieneReason}`,
  },
  // No Region column for the IAM/Route53/S3 kinds below — those AWS
  // services are global, `region` is unset on these entities (ADR-0078).
  'iam-user-inactive': {
    title: 'IAM Users — Inactive',
    head: ['User Name', 'ARN', 'Created'],
    row: (u) => [u.userName, u.arn, day(u.createdAt)],
    recommend: (u) => `Review/deactivate IAM user "${u.userName}" (${u.arn}) — ${u.hygieneReason}`,
  },
  'iam-policy-unattached': {
    title: 'IAM Policies — Unattached',
    head: ['Policy Name', 'ARN', 'Created'],
    row: (p) => [p.policyName, p.arn, day(p.createdAt)],
    recommend: (p) => `Delete unattached IAM policy "${p.policyName}" (${p.arn})`,
  },
  'iam-role-unused': {
    title: 'IAM Roles — Unused',
    head: ['Role Name', 'ARN', 'Created'],
    row: (r) => [r.roleName, r.arn, day(r.createdAt)],
    recommend: (r) => `Review/delete unused IAM role "${r.roleName}" (${r.arn}) — ${r.hygieneReason}`,
  },
  'iam-access-key-stale': {
    title: 'IAM Access Keys — Stale',
    head: ['Access Key ID', 'User Name', 'Created'],
    row: (k) => [k.id, k.userName, day(k.createdAt)],
    recommend: (k) => `Rotate or delete stale access key ${k.id} for IAM user "${k.userName}" — ${k.hygieneReason}`,
  },
  'ec2-security-group-unused': {
    title: 'EC2 Security Groups — Unused',
    head: ['Group ID', 'Group Name', 'Region'],
    row: (sg) => [sg.id, sg.groupName, sg.region.code],
    recommend: (sg) => `Delete unused security group "${sg.groupName}" (${sg.id}) in ${sg.region.code}`,
  },
  'logs-loggroup-empty': {
    title: 'CloudWatch Log Groups — Empty',
    head: ['Log Group', 'Region', 'Created'],
    row: (lg) => [lg.logGroupName, lg.region.code, day(lg.createdAt)],
    recommend: (lg) => `Delete empty CloudWatch log group "${lg.logGroupName}" in ${lg.region.code}`,
  },
  'acm-certificate-unused': {
    title: 'ACM Certificates — Unused',
    head: ['Domain Name', 'Region', 'Created'],
    row: (c) => [c.domainName, c.region.code, day(c.createdAt)],
    recommend: (c) => `Delete unused ACM certificate for "${c.domainName}" in ${c.region.code}`,
  },
  'route53-hostedzone-empty': {
    title: 'Route53 Hosted Zones — Empty',
    head: ['Zone Name', 'Zone ID'],
    row: (z) => [z.name, z.id],
    recommend: (z) => `Delete empty Route53 hosted zone "${z.name}" (${z.id}) — ${z.hygieneReason}`,
  },
  'cloudformation-stack-stuck': {
    title: 'CloudFormation Stacks — Stuck',
    head: ['Stack Name', 'Status', 'Region', 'Created'],
    row: (s) => [s.stackName, s.status, s.region.code, day(s.createdAt)],
    recommend: (s) => `Resolve stuck CloudFormation stack "${s.stackName}" (${s.status}) in ${s.region.code}`,
  },
  's3-bucket-empty': {
    title: 'S3 Buckets — Empty',
    head: ['Bucket Name', 'Created'],
    row: (b) => [b.bucketName, day(b.createdAt)],
    recommend: (b) => `Delete empty S3 bucket "${b.bucketName}"`,
  },
  'cloudwatch-alarm-orphaned': {
    title: 'CloudWatch Alarms — Orphaned',
    head: ['Alarm Name', 'Region', 'Last Config Update'],
    row: (a) => [a.alarmName, a.region.code, day(a.createdAt)],
    recommend: (a) => `Review/delete orphaned CloudWatch alarm "${a.alarmName}" in ${a.region.code} — ${a.hygieneReason}`,
  },
  'sns-topic-unsubscribed': {
    title: 'SNS Topics — No Subscriptions',
    head: ['Topic Name', 'Region'],
    row: (t) => [t.topicName, t.region.code],
    recommend: (t) => `Delete unsubscribed SNS topic "${t.topicName}" in ${t.region.code}`,
  },
  // No Region column — IAM instance profiles are global (ADR-0078).
  'iam-instance-profile-unattached': {
    title: 'IAM Instance Profiles — Unattached',
    head: ['Profile Name', 'ARN', 'Created'],
    row: (p) => [p.instanceProfileName, p.arn, day(p.createdAt)],
    recommend: (p) => `Delete unattached IAM instance profile "${p.instanceProfileName}" (${p.arn})`,
  },
  'eventbridge-rule-no-targets': {
    title: 'EventBridge Rules — No Targets',
    head: ['Rule Name', 'Region'],
    row: (r) => [r.ruleName, r.region.code],
    recommend: (r) => `Delete or attach a target to EventBridge rule "${r.ruleName}" in ${r.region.code} — ${r.hygieneReason}`,
  },
  'ecr-repository-empty': {
    title: 'ECR Repositories — Empty',
    head: ['Repository Name', 'Region', 'Created'],
    row: (r) => [r.repositoryName, r.region.code, day(r.createdAt)],
    recommend: (r) => `Delete empty ECR repository "${r.repositoryName}" in ${r.region.code}`,
  },
  'stepfunctions-statemachine-unused': {
    title: 'Step Functions State Machines — Never Executed',
    head: ['State Machine Name', 'Region', 'Created'],
    row: (m) => [m.name, m.region.code, day(m.createdAt)],
    recommend: (m) => `Review/delete unused Step Functions state machine "${m.name}" in ${m.region.code} — ${m.hygieneReason}`,
  },
};

export function presenterFor(kind: DeadResourceKind): Omit<DeadResourcePresenter, 'row' | 'recommend'> {
  return presenters[kind];
}

/** Exhaustive switch on `finding.kind` (ADR-0059) — a missing case fails the build. */
export function rowFor(finding: DeadResourceKindMap[DeadResourceKind]): string[] {
  switch (finding.kind) {
    case 'ec2-keypair-unused':
      return presenters['ec2-keypair-unused'].row(finding);
    case 'ec2-ri-expiring-soon':
      return presenters['ec2-ri-expiring-soon'].row(finding);
    case 'iam-user-inactive':
      return presenters['iam-user-inactive'].row(finding);
    case 'iam-policy-unattached':
      return presenters['iam-policy-unattached'].row(finding);
    case 'iam-role-unused':
      return presenters['iam-role-unused'].row(finding);
    case 'iam-access-key-stale':
      return presenters['iam-access-key-stale'].row(finding);
    case 'ec2-security-group-unused':
      return presenters['ec2-security-group-unused'].row(finding);
    case 'logs-loggroup-empty':
      return presenters['logs-loggroup-empty'].row(finding);
    case 'acm-certificate-unused':
      return presenters['acm-certificate-unused'].row(finding);
    case 'route53-hostedzone-empty':
      return presenters['route53-hostedzone-empty'].row(finding);
    case 'cloudformation-stack-stuck':
      return presenters['cloudformation-stack-stuck'].row(finding);
    case 's3-bucket-empty':
      return presenters['s3-bucket-empty'].row(finding);
    case 'cloudwatch-alarm-orphaned':
      return presenters['cloudwatch-alarm-orphaned'].row(finding);
    case 'sns-topic-unsubscribed':
      return presenters['sns-topic-unsubscribed'].row(finding);
    case 'iam-instance-profile-unattached':
      return presenters['iam-instance-profile-unattached'].row(finding);
    case 'eventbridge-rule-no-targets':
      return presenters['eventbridge-rule-no-targets'].row(finding);
    case 'ecr-repository-empty':
      return presenters['ecr-repository-empty'].row(finding);
    case 'stepfunctions-statemachine-unused':
      return presenters['stepfunctions-statemachine-unused'].row(finding);
  }
}

export function recommendFor(finding: DeadResourceKindMap[DeadResourceKind]): string {
  switch (finding.kind) {
    case 'ec2-keypair-unused':
      return presenters['ec2-keypair-unused'].recommend(finding);
    case 'ec2-ri-expiring-soon':
      return presenters['ec2-ri-expiring-soon'].recommend(finding);
    case 'iam-user-inactive':
      return presenters['iam-user-inactive'].recommend(finding);
    case 'iam-policy-unattached':
      return presenters['iam-policy-unattached'].recommend(finding);
    case 'iam-role-unused':
      return presenters['iam-role-unused'].recommend(finding);
    case 'iam-access-key-stale':
      return presenters['iam-access-key-stale'].recommend(finding);
    case 'ec2-security-group-unused':
      return presenters['ec2-security-group-unused'].recommend(finding);
    case 'logs-loggroup-empty':
      return presenters['logs-loggroup-empty'].recommend(finding);
    case 'acm-certificate-unused':
      return presenters['acm-certificate-unused'].recommend(finding);
    case 'route53-hostedzone-empty':
      return presenters['route53-hostedzone-empty'].recommend(finding);
    case 'cloudformation-stack-stuck':
      return presenters['cloudformation-stack-stuck'].recommend(finding);
    case 's3-bucket-empty':
      return presenters['s3-bucket-empty'].recommend(finding);
    case 'cloudwatch-alarm-orphaned':
      return presenters['cloudwatch-alarm-orphaned'].recommend(finding);
    case 'sns-topic-unsubscribed':
      return presenters['sns-topic-unsubscribed'].recommend(finding);
    case 'iam-instance-profile-unattached':
      return presenters['iam-instance-profile-unattached'].recommend(finding);
    case 'eventbridge-rule-no-targets':
      return presenters['eventbridge-rule-no-targets'].recommend(finding);
    case 'ecr-repository-empty':
      return presenters['ecr-repository-empty'].recommend(finding);
    case 'stepfunctions-statemachine-unused':
      return presenters['stepfunctions-statemachine-unused'].recommend(finding);
  }
}
