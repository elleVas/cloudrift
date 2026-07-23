// SPDX-License-Identifier: Apache-2.0
// Re-exported from cloud-cost-domain: a generic AWS value object this domain
// needs too, not duplicated here to avoid two region-code lists drifting
// out of sync (ADR-0078).
export { AwsRegion } from 'cloud-cost-domain';

// Dead resource model
export { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META } from './dead-resource';
export type {
  DeadResourceKind,
  DeadResourceSeverity,
  DeadResourceScope,
  DeadResourceKindMeta,
  DeadResource,
} from './dead-resource';
export { groupByKind } from './group-by-kind';
export type { DeadResourceKindMap, DeadFindingsByKind } from './group-by-kind';

// Entities
export { Ec2KeyPairUnused } from './entities/ec2-keypair-unused.entity';
export type { Ec2KeyPairUnusedProps } from './entities/ec2-keypair-unused.entity';
export { Ec2RiExpiringSoon } from './entities/ec2-ri-expiring-soon.entity';
export type { Ec2RiExpiringSoonProps } from './entities/ec2-ri-expiring-soon.entity';
export { IamUserInactive } from './entities/iam-user-inactive.entity';
export type { IamUserInactiveProps } from './entities/iam-user-inactive.entity';
export { IamPolicyUnattached } from './entities/iam-policy-unattached.entity';
export type { IamPolicyUnattachedProps } from './entities/iam-policy-unattached.entity';
export { IamRoleUnused } from './entities/iam-role-unused.entity';
export type { IamRoleUnusedProps } from './entities/iam-role-unused.entity';
export { IamAccessKeyStale } from './entities/iam-access-key-stale.entity';
export type { IamAccessKeyStaleProps } from './entities/iam-access-key-stale.entity';
export { Ec2SecurityGroupUnused } from './entities/ec2-security-group-unused.entity';
export type { Ec2SecurityGroupUnusedProps } from './entities/ec2-security-group-unused.entity';
export { LogsLogGroupEmpty } from './entities/logs-loggroup-empty.entity';
export type { LogsLogGroupEmptyProps } from './entities/logs-loggroup-empty.entity';
export { AcmCertificateUnused } from './entities/acm-certificate-unused.entity';
export type { AcmCertificateUnusedProps } from './entities/acm-certificate-unused.entity';
export { Route53HostedZoneEmpty } from './entities/route53-hostedzone-empty.entity';
export type { Route53HostedZoneEmptyProps } from './entities/route53-hostedzone-empty.entity';
export { CloudformationStackStuck } from './entities/cloudformation-stack-stuck.entity';
export type { CloudformationStackStuckProps } from './entities/cloudformation-stack-stuck.entity';
export { S3BucketEmpty } from './entities/s3-bucket-empty.entity';
export type { S3BucketEmptyProps } from './entities/s3-bucket-empty.entity';
export { CloudwatchAlarmOrphaned } from './entities/cloudwatch-alarm-orphaned.entity';
export type { CloudwatchAlarmOrphanedProps } from './entities/cloudwatch-alarm-orphaned.entity';
export { SnsTopicUnsubscribed } from './entities/sns-topic-unsubscribed.entity';
export type { SnsTopicUnsubscribedProps } from './entities/sns-topic-unsubscribed.entity';
export { IamInstanceProfileUnattached } from './entities/iam-instance-profile-unattached.entity';
export type { IamInstanceProfileUnattachedProps } from './entities/iam-instance-profile-unattached.entity';
export { EventbridgeRuleNoTargets } from './entities/eventbridge-rule-no-targets.entity';
export type { EventbridgeRuleNoTargetsProps } from './entities/eventbridge-rule-no-targets.entity';
export { EcrRepositoryEmpty } from './entities/ecr-repository-empty.entity';
export type { EcrRepositoryEmptyProps } from './entities/ecr-repository-empty.entity';
export { StepfunctionsStatemachineUnused } from './entities/stepfunctions-statemachine-unused.entity';
export type { StepfunctionsStatemachineUnusedProps } from './entities/stepfunctions-statemachine-unused.entity';

// Policies
export {
  DeadResourcePolicy,
  flagged,
  notFlagged,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_IGNORE_TAG,
} from './policies/dead-resource-policy';
export type { HygieneVerdict, DeadResourcePolicyOptions } from './policies/dead-resource-policy';
export { Ec2KeyPairUnusedPolicy } from './policies/ec2-keypair-unused.policy';
export { Ec2RiExpiringSoonPolicy, DEFAULT_EXPIRING_WITHIN_DAYS } from './policies/ec2-ri-expiring-soon.policy';
export { IamUserInactivePolicy, DEFAULT_INACTIVITY_DAYS } from './policies/iam-user-inactive.policy';
export { IamPolicyUnattachedPolicy } from './policies/iam-policy-unattached.policy';
export { IamRoleUnusedPolicy, DEFAULT_ROLE_INACTIVITY_DAYS } from './policies/iam-role-unused.policy';
export { IamAccessKeyStalePolicy, DEFAULT_ACCESS_KEY_MAX_AGE_DAYS } from './policies/iam-access-key-stale.policy';
export { Ec2SecurityGroupUnusedPolicy } from './policies/ec2-security-group-unused.policy';
export { LogsLogGroupEmptyPolicy } from './policies/logs-loggroup-empty.policy';
export { AcmCertificateUnusedPolicy } from './policies/acm-certificate-unused.policy';
export { Route53HostedZoneEmptyPolicy } from './policies/route53-hostedzone-empty.policy';
export { CloudformationStackStuckPolicy } from './policies/cloudformation-stack-stuck.policy';
export { S3BucketEmptyPolicy } from './policies/s3-bucket-empty.policy';
export { CloudwatchAlarmOrphanedPolicy } from './policies/cloudwatch-alarm-orphaned.policy';
export { SnsTopicUnsubscribedPolicy } from './policies/sns-topic-unsubscribed.policy';
export { IamInstanceProfileUnattachedPolicy } from './policies/iam-instance-profile-unattached.policy';
export { EventbridgeRuleNoTargetsPolicy } from './policies/eventbridge-rule-no-targets.policy';
export { EcrRepositoryEmptyPolicy } from './policies/ecr-repository-empty.policy';
export { StepfunctionsStatemachineUnusedPolicy } from './policies/stepfunctions-statemachine-unused.policy';

// Ports
export type { DeadResourceScannerPort } from './ports/outbound/dead-resource-scanner.port';
export type {
  FindDeadResourcesRequest,
  DeadResourceScanError,
  DeadResourcesSummary,
  FindDeadResourcesUseCasePort,
} from './ports/inbound/find-dead-resources.use-case.port';
