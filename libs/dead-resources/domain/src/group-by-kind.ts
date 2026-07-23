// SPDX-License-Identifier: Apache-2.0
import { DEAD_RESOURCE_KINDS, type DeadResourceKind, type DeadResource } from './dead-resource';
import type { Ec2KeyPairUnused } from './entities/ec2-keypair-unused.entity';
import type { Ec2RiExpiringSoon } from './entities/ec2-ri-expiring-soon.entity';
import type { IamUserInactive } from './entities/iam-user-inactive.entity';
import type { IamPolicyUnattached } from './entities/iam-policy-unattached.entity';
import type { IamRoleUnused } from './entities/iam-role-unused.entity';
import type { IamAccessKeyStale } from './entities/iam-access-key-stale.entity';
import type { Ec2SecurityGroupUnused } from './entities/ec2-security-group-unused.entity';
import type { LogsLogGroupEmpty } from './entities/logs-loggroup-empty.entity';
import type { AcmCertificateUnused } from './entities/acm-certificate-unused.entity';
import type { Route53HostedZoneEmpty } from './entities/route53-hostedzone-empty.entity';
import type { CloudformationStackStuck } from './entities/cloudformation-stack-stuck.entity';
import type { S3BucketEmpty } from './entities/s3-bucket-empty.entity';
import type { CloudwatchAlarmOrphaned } from './entities/cloudwatch-alarm-orphaned.entity';
import type { SnsTopicUnsubscribed } from './entities/sns-topic-unsubscribed.entity';
import type { IamInstanceProfileUnattached } from './entities/iam-instance-profile-unattached.entity';
import type { EventbridgeRuleNoTargets } from './entities/eventbridge-rule-no-targets.entity';
import type { EcrRepositoryEmpty } from './entities/ecr-repository-empty.entity';
import type { StepfunctionsStatemachineUnused } from './entities/stepfunctions-statemachine-unused.entity';

/**
 * Map kind → concrete entity. Allows consumers (formatters) to retrieve the
 * specific type from the kind without manual casts.
 */
export interface DeadResourceKindMap {
  'ec2-keypair-unused': Ec2KeyPairUnused;
  'ec2-ri-expiring-soon': Ec2RiExpiringSoon;
  'iam-user-inactive': IamUserInactive;
  'iam-policy-unattached': IamPolicyUnattached;
  'iam-role-unused': IamRoleUnused;
  'iam-access-key-stale': IamAccessKeyStale;
  'ec2-security-group-unused': Ec2SecurityGroupUnused;
  'logs-loggroup-empty': LogsLogGroupEmpty;
  'acm-certificate-unused': AcmCertificateUnused;
  'route53-hostedzone-empty': Route53HostedZoneEmpty;
  'cloudformation-stack-stuck': CloudformationStackStuck;
  's3-bucket-empty': S3BucketEmpty;
  'cloudwatch-alarm-orphaned': CloudwatchAlarmOrphaned;
  'sns-topic-unsubscribed': SnsTopicUnsubscribed;
  'iam-instance-profile-unattached': IamInstanceProfileUnattached;
  'eventbridge-rule-no-targets': EventbridgeRuleNoTargets;
  'ecr-repository-empty': EcrRepositoryEmpty;
  'stepfunctions-statemachine-unused': StepfunctionsStatemachineUnused;
}

export type DeadFindingsByKind = {
  [K in DeadResourceKind]: DeadResourceKindMap[K][];
};

export function groupByKind(findings: readonly DeadResource[]): DeadFindingsByKind {
  const grouped = Object.fromEntries(
    DEAD_RESOURCE_KINDS.map((kind) => [kind, []]),
  ) as unknown as DeadFindingsByKind;

  for (const finding of findings) {
    (grouped[finding.kind] as DeadResource[]).push(finding);
  }

  return grouped;
}
