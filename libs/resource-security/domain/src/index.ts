// SPDX-License-Identifier: Apache-2.0
// Re-exported from cloud-cost-domain: a generic AWS value object this domain
// needs too, not duplicated here to avoid two region-code lists drifting
// out of sync (mirrors dead-resources-domain, ADR-0078).
export { AwsRegion } from 'cloud-cost-domain';

// Resource security model
export { RESOURCE_SECURITY_KINDS, RESOURCE_SECURITY_KIND_META } from './resource-security';
export type {
  ResourceSecurityKind,
  ResourceSecuritySeverity,
  ResourceSecurityScope,
  ResourceSecurityKindMeta,
  SecurityFinding,
} from './resource-security';
export { groupByKind } from './group-by-kind';
export type { ResourceSecurityKindMap, SecurityFindingsByKind } from './group-by-kind';

// Entities
export { IamRootMfaDisabled } from './entities/iam-root-mfa-disabled.entity';
export type { IamRootMfaDisabledProps } from './entities/iam-root-mfa-disabled.entity';
export { IamUserMfaDisabled } from './entities/iam-user-mfa-disabled.entity';
export type { IamUserMfaDisabledProps } from './entities/iam-user-mfa-disabled.entity';
export { IamAccessKeyRotationOverdue } from './entities/iam-access-key-rotation-overdue.entity';
export type { IamAccessKeyRotationOverdueProps } from './entities/iam-access-key-rotation-overdue.entity';
export { IamRootAccessKeyActive } from './entities/iam-root-access-key-active.entity';
export type { IamRootAccessKeyActiveProps } from './entities/iam-root-access-key-active.entity';
export { IamPasswordPolicyWeak } from './entities/iam-password-policy-weak.entity';
export type { IamPasswordPolicyWeakProps } from './entities/iam-password-policy-weak.entity';
export { Ec2SecurityGroupOpenIngress } from './entities/ec2-security-group-open-ingress.entity';
export type { Ec2SecurityGroupOpenIngressProps } from './entities/ec2-security-group-open-ingress.entity';
export { Ec2DefaultSecurityGroupPermissive } from './entities/ec2-default-security-group-permissive.entity';
export type { Ec2DefaultSecurityGroupPermissiveProps } from './entities/ec2-default-security-group-permissive.entity';
export { S3BucketPublic } from './entities/s3-bucket-public.entity';
export type { S3BucketPublicProps } from './entities/s3-bucket-public.entity';
export { Ec2SnapshotPublic } from './entities/ec2-snapshot-public.entity';
export type { Ec2SnapshotPublicProps } from './entities/ec2-snapshot-public.entity';
export { Ec2VolumeUnencrypted } from './entities/ec2-volume-unencrypted.entity';
export type { Ec2VolumeUnencryptedProps } from './entities/ec2-volume-unencrypted.entity';
export { RdsInstanceUnencrypted } from './entities/rds-instance-unencrypted.entity';
export type { RdsInstanceUnencryptedProps } from './entities/rds-instance-unencrypted.entity';
export { S3BucketEncryptionMissing } from './entities/s3-bucket-encryption-missing.entity';
export type { S3BucketEncryptionMissingProps } from './entities/s3-bucket-encryption-missing.entity';
export { RdsInstancePubliclyAccessible } from './entities/rds-instance-publicly-accessible.entity';
export type { RdsInstancePubliclyAccessibleProps } from './entities/rds-instance-publicly-accessible.entity';
export { CloudtrailNotMultiregion } from './entities/cloudtrail-not-multiregion.entity';
export type { CloudtrailNotMultiregionProps } from './entities/cloudtrail-not-multiregion.entity';

// Policies
export {
  ResourceSecurityPolicy,
  flagged,
  notFlagged,
  DEFAULT_IGNORE_TAG,
} from './policies/resource-security-policy';
export type { RiskVerdict, ResourceSecurityPolicyOptions } from './policies/resource-security-policy';
export { IamRootMfaDisabledPolicy } from './policies/iam-root-mfa-disabled.policy';
export { IamUserMfaDisabledPolicy } from './policies/iam-user-mfa-disabled.policy';
export { IamAccessKeyRotationOverduePolicy, DEFAULT_ACCESS_KEY_MAX_AGE_DAYS } from './policies/iam-access-key-rotation-overdue.policy';
export { IamRootAccessKeyActivePolicy } from './policies/iam-root-access-key-active.policy';
export { IamPasswordPolicyWeakPolicy } from './policies/iam-password-policy-weak.policy';
export { Ec2SecurityGroupOpenIngressPolicy } from './policies/ec2-security-group-open-ingress.policy';
export { Ec2DefaultSecurityGroupPermissivePolicy } from './policies/ec2-default-security-group-permissive.policy';
export { S3BucketPublicPolicy } from './policies/s3-bucket-public.policy';
export { Ec2SnapshotPublicPolicy } from './policies/ec2-snapshot-public.policy';
export { Ec2VolumeUnencryptedPolicy } from './policies/ec2-volume-unencrypted.policy';
export { RdsInstanceUnencryptedPolicy } from './policies/rds-instance-unencrypted.policy';
export { S3BucketEncryptionMissingPolicy } from './policies/s3-bucket-encryption-missing.policy';
export { RdsInstancePubliclyAccessiblePolicy } from './policies/rds-instance-publicly-accessible.policy';
export { CloudtrailNotMultiregionPolicy } from './policies/cloudtrail-not-multiregion.policy';

// Ports
export type { ResourceSecurityScannerPort } from './ports/outbound/resource-security-scanner.port';
export type {
  FindResourceSecurityFindingsRequest,
  ResourceSecurityScanError,
  ResourceSecuritySummary,
  FindResourceSecurityFindingsUseCasePort,
} from './ports/inbound/find-resource-security-findings.use-case.port';
