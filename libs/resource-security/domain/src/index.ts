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
export { GuarddutyNotEnabled } from './entities/guardduty-not-enabled.entity';
export type { GuarddutyNotEnabledProps } from './entities/guardduty-not-enabled.entity';
export { ConfigNotEnabled } from './entities/config-not-enabled.entity';
export type { ConfigNotEnabledProps } from './entities/config-not-enabled.entity';
export { SecurityHubNotEnabled } from './entities/security-hub-not-enabled.entity';
export type { SecurityHubNotEnabledProps } from './entities/security-hub-not-enabled.entity';
export { VpcFlowLogsDisabled } from './entities/vpc-flow-logs-disabled.entity';
export type { VpcFlowLogsDisabledProps } from './entities/vpc-flow-logs-disabled.entity';
export { KmsKeyRotationDisabled } from './entities/kms-key-rotation-disabled.entity';
export type { KmsKeyRotationDisabledProps } from './entities/kms-key-rotation-disabled.entity';
export { S3AccountPublicAccessBlockDisabled } from './entities/s3-account-public-access-block-disabled.entity';
export type { S3AccountPublicAccessBlockDisabledProps } from './entities/s3-account-public-access-block-disabled.entity';
export { S3BucketVersioningDisabled } from './entities/s3-bucket-versioning-disabled.entity';
export type { S3BucketVersioningDisabledProps } from './entities/s3-bucket-versioning-disabled.entity';
export { RedshiftClusterPubliclyAccessible } from './entities/redshift-cluster-publicly-accessible.entity';
export type { RedshiftClusterPubliclyAccessibleProps } from './entities/redshift-cluster-publicly-accessible.entity';
export { IamUserPolicyWildcard } from './entities/iam-user-policy-wildcard.entity';
export type { IamUserPolicyWildcardProps } from './entities/iam-user-policy-wildcard.entity';
export { AcmCertificateExpiring } from './entities/acm-certificate-expiring.entity';
export type { AcmCertificateExpiringProps } from './entities/acm-certificate-expiring.entity';
export { LambdaFunctionPolicyPublic } from './entities/lambda-function-policy-public.entity';
export type { LambdaFunctionPolicyPublicProps } from './entities/lambda-function-policy-public.entity';
export { SnsTopicPolicyPublic } from './entities/sns-topic-policy-public.entity';
export type { SnsTopicPolicyPublicProps } from './entities/sns-topic-policy-public.entity';
export { SqsQueuePolicyPublic } from './entities/sqs-queue-policy-public.entity';
export type { SqsQueuePolicyPublicProps } from './entities/sqs-queue-policy-public.entity';
export { EcrRepositoryPolicyPublic } from './entities/ecr-repository-policy-public.entity';
export type { EcrRepositoryPolicyPublicProps } from './entities/ecr-repository-policy-public.entity';
export { SecretsManagerSecretPolicyPublic } from './entities/secrets-manager-secret-policy-public.entity';
export type { SecretsManagerSecretPolicyPublicProps } from './entities/secrets-manager-secret-policy-public.entity';

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
export { GuarddutyNotEnabledPolicy } from './policies/guardduty-not-enabled.policy';
export { ConfigNotEnabledPolicy } from './policies/config-not-enabled.policy';
export { SecurityHubNotEnabledPolicy } from './policies/security-hub-not-enabled.policy';
export { VpcFlowLogsDisabledPolicy } from './policies/vpc-flow-logs-disabled.policy';
export { KmsKeyRotationDisabledPolicy } from './policies/kms-key-rotation-disabled.policy';
export { S3AccountPublicAccessBlockDisabledPolicy } from './policies/s3-account-public-access-block-disabled.policy';
export { S3BucketVersioningDisabledPolicy } from './policies/s3-bucket-versioning-disabled.policy';
export { RedshiftClusterPubliclyAccessiblePolicy } from './policies/redshift-cluster-publicly-accessible.policy';
export { IamUserPolicyWildcardPolicy } from './policies/iam-user-policy-wildcard.policy';
export { AcmCertificateExpiringPolicy, DEFAULT_CERT_EXPIRY_WARNING_DAYS } from './policies/acm-certificate-expiring.policy';
export { LambdaFunctionPolicyPublicPolicy } from './policies/lambda-function-policy-public.policy';
export { SnsTopicPolicyPublicPolicy } from './policies/sns-topic-policy-public.policy';
export { SqsQueuePolicyPublicPolicy } from './policies/sqs-queue-policy-public.policy';
export { EcrRepositoryPolicyPublicPolicy } from './policies/ecr-repository-policy-public.policy';
export { SecretsManagerSecretPolicyPublicPolicy } from './policies/secrets-manager-secret-policy-public.policy';

// Ports
export type { ResourceSecurityScannerPort } from './ports/outbound/resource-security-scanner.port';
export type {
  FindResourceSecurityFindingsRequest,
  ResourceSecurityScanError,
  ResourceSecuritySummary,
  FindResourceSecurityFindingsUseCasePort,
} from './ports/inbound/find-resource-security-findings.use-case.port';
