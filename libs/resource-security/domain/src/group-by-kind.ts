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
}

export type SecurityFindingsByKind = {
  [K in ResourceSecurityKind]: ResourceSecurityKindMap[K][];
};

export function groupByKind(findings: readonly SecurityFinding[]): SecurityFindingsByKind {
  const grouped = Object.fromEntries(
    RESOURCE_SECURITY_KINDS.map((kind) => [kind, []]),
  ) as unknown as SecurityFindingsByKind;

  for (const finding of findings) {
    (grouped[finding.kind] as SecurityFinding[]).push(finding);
  }

  return grouped;
}
