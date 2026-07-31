// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_SECURITY_KINDS, type ResourceSecurityKind, type SecurityFinding } from './resource-security';
import type { IamRootMfaDisabled } from './entities/iam-root-mfa-disabled.entity';
import type { IamUserMfaDisabled } from './entities/iam-user-mfa-disabled.entity';
import type { IamAccessKeyRotationOverdue } from './entities/iam-access-key-rotation-overdue.entity';
import type { IamRootAccessKeyActive } from './entities/iam-root-access-key-active.entity';
import type { IamPasswordPolicyWeak } from './entities/iam-password-policy-weak.entity';
import type { Ec2SecurityGroupOpenIngress } from './entities/ec2-security-group-open-ingress.entity';
import type { Ec2DefaultSecurityGroupPermissive } from './entities/ec2-default-security-group-permissive.entity';
import type { S3BucketPublic } from './entities/s3-bucket-public.entity';
import type { Ec2SnapshotPublic } from './entities/ec2-snapshot-public.entity';
import type { Ec2VolumeUnencrypted } from './entities/ec2-volume-unencrypted.entity';
import type { RdsInstanceUnencrypted } from './entities/rds-instance-unencrypted.entity';
import type { S3BucketEncryptionMissing } from './entities/s3-bucket-encryption-missing.entity';
import type { RdsInstancePubliclyAccessible } from './entities/rds-instance-publicly-accessible.entity';
import type { CloudtrailNotMultiregion } from './entities/cloudtrail-not-multiregion.entity';
import type { GuarddutyNotEnabled } from './entities/guardduty-not-enabled.entity';
import type { ConfigNotEnabled } from './entities/config-not-enabled.entity';
import type { SecurityHubNotEnabled } from './entities/security-hub-not-enabled.entity';
import type { VpcFlowLogsDisabled } from './entities/vpc-flow-logs-disabled.entity';
import type { KmsKeyRotationDisabled } from './entities/kms-key-rotation-disabled.entity';
import type { S3AccountPublicAccessBlockDisabled } from './entities/s3-account-public-access-block-disabled.entity';
import type { S3BucketVersioningDisabled } from './entities/s3-bucket-versioning-disabled.entity';
import type { RedshiftClusterPubliclyAccessible } from './entities/redshift-cluster-publicly-accessible.entity';
import type { IamUserPolicyWildcard } from './entities/iam-user-policy-wildcard.entity';
import type { AcmCertificateExpiring } from './entities/acm-certificate-expiring.entity';
import type { LambdaFunctionPolicyPublic } from './entities/lambda-function-policy-public.entity';
import type { SnsTopicPolicyPublic } from './entities/sns-topic-policy-public.entity';
import type { SqsQueuePolicyPublic } from './entities/sqs-queue-policy-public.entity';
import type { EcrRepositoryPolicyPublic } from './entities/ecr-repository-policy-public.entity';
import type { SecretsManagerSecretPolicyPublic } from './entities/secrets-manager-secret-policy-public.entity';

/**
 * Map kind → concrete entity. Allows consumers (formatters) to retrieve the
 * specific type from the kind without manual casts.
 */
export interface ResourceSecurityKindMap {
  'iam-root-mfa-disabled': IamRootMfaDisabled;
  'iam-user-mfa-disabled': IamUserMfaDisabled;
  'iam-access-key-rotation-overdue': IamAccessKeyRotationOverdue;
  'iam-root-access-key-active': IamRootAccessKeyActive;
  'iam-password-policy-weak': IamPasswordPolicyWeak;
  'ec2-security-group-open-ingress': Ec2SecurityGroupOpenIngress;
  'ec2-default-security-group-permissive': Ec2DefaultSecurityGroupPermissive;
  's3-bucket-public': S3BucketPublic;
  'ec2-snapshot-public': Ec2SnapshotPublic;
  'ec2-volume-unencrypted': Ec2VolumeUnencrypted;
  'rds-instance-unencrypted': RdsInstanceUnencrypted;
  's3-bucket-encryption-missing': S3BucketEncryptionMissing;
  'rds-instance-publicly-accessible': RdsInstancePubliclyAccessible;
  'cloudtrail-not-multiregion': CloudtrailNotMultiregion;
  'guardduty-not-enabled': GuarddutyNotEnabled;
  'config-not-enabled': ConfigNotEnabled;
  'security-hub-not-enabled': SecurityHubNotEnabled;
  'vpc-flow-logs-disabled': VpcFlowLogsDisabled;
  'kms-key-rotation-disabled': KmsKeyRotationDisabled;
  's3-account-public-access-block-disabled': S3AccountPublicAccessBlockDisabled;
  's3-bucket-versioning-disabled': S3BucketVersioningDisabled;
  'redshift-cluster-publicly-accessible': RedshiftClusterPubliclyAccessible;
  'iam-user-policy-wildcard': IamUserPolicyWildcard;
  'acm-certificate-expiring': AcmCertificateExpiring;
  'lambda-function-policy-public': LambdaFunctionPolicyPublic;
  'sns-topic-policy-public': SnsTopicPolicyPublic;
  'sqs-queue-policy-public': SqsQueuePolicyPublic;
  'ecr-repository-policy-public': EcrRepositoryPolicyPublic;
  'secrets-manager-secret-policy-public': SecretsManagerSecretPolicyPublic;
}

export type SecurityFindingsByKind = {
  [K in ResourceSecurityKind]: ResourceSecurityKindMap[K][];
};

export function groupByKind(findings: readonly SecurityFinding[]): SecurityFindingsByKind {
  // Casts, not narrowed: same shape as `cloud-cost-domain`'s `groupByKind`
  // (ADR-0078 deliberate copy) — `Object.fromEntries` discards the per-key
  // literal types `SecurityFindingsByKind` encodes, and `finding.kind` only
  // proves which union member it is, not that `grouped[finding.kind]` is
  // that member's array type. Already isolated in this one function; moving
  // either cast to a caller would just multiply it, not remove it.
  const grouped = Object.fromEntries(
    RESOURCE_SECURITY_KINDS.map((kind) => [kind, []]),
  ) as unknown as SecurityFindingsByKind;

  for (const finding of findings) {
    (grouped[finding.kind] as SecurityFinding[]).push(finding);
  }

  return grouped;
}
