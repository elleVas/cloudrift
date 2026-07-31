// SPDX-License-Identifier: Apache-2.0
import type {
  AwsRegion,
  ResourceSecurityKind,
  ResourceSecurityPolicyOptions,
  ResourceSecurityScannerPort,
  FindResourceSecurityFindingsUseCasePort,
} from 'resource-security-domain';
import {
  IamRootMfaDisabledPolicy,
  IamUserMfaDisabledPolicy,
  IamAccessKeyRotationOverduePolicy,
  IamRootAccessKeyActivePolicy,
  IamPasswordPolicyWeakPolicy,
  Ec2SecurityGroupOpenIngressPolicy,
  Ec2DefaultSecurityGroupPermissivePolicy,
  S3BucketPublicPolicy,
  Ec2SnapshotPublicPolicy,
  Ec2VolumeUnencryptedPolicy,
  RdsInstanceUnencryptedPolicy,
  S3BucketEncryptionMissingPolicy,
  RdsInstancePubliclyAccessiblePolicy,
  CloudtrailNotMultiregionPolicy,
  GuarddutyNotEnabledPolicy,
  ConfigNotEnabledPolicy,
  SecurityHubNotEnabledPolicy,
  VpcFlowLogsDisabledPolicy,
  KmsKeyRotationDisabledPolicy,
  S3AccountPublicAccessBlockDisabledPolicy,
  S3BucketVersioningDisabledPolicy,
  RedshiftClusterPubliclyAccessiblePolicy,
  IamUserPolicyWildcardPolicy,
  AcmCertificateExpiringPolicy,
  LambdaFunctionPolicyPublicPolicy,
  SnsTopicPolicyPublicPolicy,
  SqsQueuePolicyPublicPolicy,
  EcrRepositoryPolicyPublicPolicy,
  SecretsManagerSecretPolicyPublicPolicy,
} from 'resource-security-domain';
import { FindResourceSecurityFindingsUseCase } from 'resource-security-application';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import {
  AwsIamRootMfaDisabledScanner,
  AwsIamUserMfaDisabledScanner,
  AwsIamAccessKeyRotationOverdueScanner,
  AwsIamRootAccessKeyActiveScanner,
  AwsIamPasswordPolicyWeakScanner,
  AwsEc2SecurityGroupOpenIngressScanner,
  AwsEc2DefaultSecurityGroupPermissiveScanner,
  AwsS3BucketPublicScanner,
  AwsEc2SnapshotPublicScanner,
  AwsEc2VolumeUnencryptedScanner,
  AwsRdsInstanceUnencryptedScanner,
  AwsS3BucketEncryptionMissingScanner,
  AwsRdsInstancePubliclyAccessibleScanner,
  AwsCloudtrailNotMultiregionScanner,
  AwsGuarddutyNotEnabledScanner,
  AwsConfigNotEnabledScanner,
  AwsSecurityHubNotEnabledScanner,
  AwsVpcFlowLogsDisabledScanner,
  AwsKmsKeyRotationDisabledScanner,
  AwsS3AccountPublicAccessBlockDisabledScanner,
  AwsS3BucketVersioningDisabledScanner,
  AwsRedshiftClusterPubliclyAccessibleScanner,
  AwsIamUserPolicyWildcardScanner,
  AwsAcmCertificateExpiringScanner,
  AwsLambdaFunctionPolicyPublicScanner,
  AwsSnsTopicPolicyPublicScanner,
  AwsSqsQueuePolicyPublicScanner,
  AwsEcrRepositoryPolicyPublicScanner,
  AwsSecretsManagerSecretPolicyPublicScanner,
} from 'resource-security-infrastructure-aws-adapter';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';

/** Everything a resource-security scanner factory may need to build its instance. */
export interface ResourceSecurityScanContext {
  accountId: string;
  /** Set only when scanning cross-account via --assume-role-arn; undefined uses the ambient credential chain. */
  credentials?: AwsCredentialIdentityProvider;
  policyOptions: ResourceSecurityPolicyOptions;
}

/**
 * Resolved context passed to `createAnalysis` to build the scanner list.
 * Mirrors `DeadResourceAnalysisContext` (`dead-resources.composition.ts`).
 */
export interface ResourceSecurityAnalysisContext {
  regions: AwsRegion[];
  accountId: string;
  credentials?: AwsCredentialIdentityProvider;
  policyOptions: ResourceSecurityPolicyOptions;
  /** Restrict the scan to these kinds (from the wizard). Undefined runs every check. */
  scannerKinds?: ResourceSecurityKind[];
}

export interface ResourceSecurityAnalysis {
  useCase: FindResourceSecurityFindingsUseCasePort;
}

export interface ResourceSecurityDeps {
  resolveAccountId(credentials?: AwsCredentialIdentityProvider): Promise<string | undefined>;
  createAnalysis(ctx: ResourceSecurityAnalysisContext): Promise<ResourceSecurityAnalysis>;
}

/** One entry per resource-security kind — same shape as `dead-resources.composition.ts`'s `buildScanners`, 29 entries doesn't warrant a registry split (ADR-0077's threshold was 43). */
function buildScanners(ctx: ResourceSecurityScanContext): ResourceSecurityScannerPort[] {
  return [
    new AwsIamRootMfaDisabledScanner(ctx.accountId, ctx.credentials, new IamRootMfaDisabledPolicy(ctx.policyOptions)),
    new AwsIamUserMfaDisabledScanner(ctx.accountId, ctx.credentials, new IamUserMfaDisabledPolicy(ctx.policyOptions)),
    new AwsIamAccessKeyRotationOverdueScanner(ctx.accountId, ctx.credentials, new IamAccessKeyRotationOverduePolicy(ctx.policyOptions)),
    new AwsIamRootAccessKeyActiveScanner(ctx.accountId, ctx.credentials, new IamRootAccessKeyActivePolicy(ctx.policyOptions)),
    new AwsIamPasswordPolicyWeakScanner(ctx.accountId, ctx.credentials, new IamPasswordPolicyWeakPolicy(ctx.policyOptions)),
    new AwsEc2SecurityGroupOpenIngressScanner(ctx.accountId, ctx.credentials, new Ec2SecurityGroupOpenIngressPolicy(ctx.policyOptions)),
    new AwsEc2DefaultSecurityGroupPermissiveScanner(ctx.accountId, ctx.credentials, new Ec2DefaultSecurityGroupPermissivePolicy(ctx.policyOptions)),
    new AwsS3BucketPublicScanner(ctx.accountId, ctx.credentials, new S3BucketPublicPolicy(ctx.policyOptions)),
    new AwsEc2SnapshotPublicScanner(ctx.accountId, ctx.credentials, new Ec2SnapshotPublicPolicy(ctx.policyOptions)),
    new AwsEc2VolumeUnencryptedScanner(ctx.accountId, ctx.credentials, new Ec2VolumeUnencryptedPolicy(ctx.policyOptions)),
    new AwsRdsInstanceUnencryptedScanner(ctx.accountId, ctx.credentials, new RdsInstanceUnencryptedPolicy(ctx.policyOptions)),
    new AwsS3BucketEncryptionMissingScanner(ctx.accountId, ctx.credentials, new S3BucketEncryptionMissingPolicy(ctx.policyOptions)),
    new AwsRdsInstancePubliclyAccessibleScanner(ctx.accountId, ctx.credentials, new RdsInstancePubliclyAccessiblePolicy(ctx.policyOptions)),
    new AwsCloudtrailNotMultiregionScanner(ctx.accountId, ctx.credentials, new CloudtrailNotMultiregionPolicy(ctx.policyOptions)),
    new AwsGuarddutyNotEnabledScanner(ctx.accountId, ctx.credentials, new GuarddutyNotEnabledPolicy(ctx.policyOptions)),
    new AwsConfigNotEnabledScanner(ctx.accountId, ctx.credentials, new ConfigNotEnabledPolicy(ctx.policyOptions)),
    new AwsSecurityHubNotEnabledScanner(ctx.accountId, ctx.credentials, new SecurityHubNotEnabledPolicy(ctx.policyOptions)),
    new AwsVpcFlowLogsDisabledScanner(ctx.accountId, ctx.credentials, new VpcFlowLogsDisabledPolicy(ctx.policyOptions)),
    new AwsKmsKeyRotationDisabledScanner(ctx.accountId, ctx.credentials, new KmsKeyRotationDisabledPolicy(ctx.policyOptions)),
    new AwsS3AccountPublicAccessBlockDisabledScanner(ctx.accountId, ctx.credentials, new S3AccountPublicAccessBlockDisabledPolicy(ctx.policyOptions)),
    new AwsS3BucketVersioningDisabledScanner(ctx.accountId, ctx.credentials, new S3BucketVersioningDisabledPolicy(ctx.policyOptions)),
    new AwsRedshiftClusterPubliclyAccessibleScanner(ctx.accountId, ctx.credentials, new RedshiftClusterPubliclyAccessiblePolicy(ctx.policyOptions)),
    new AwsIamUserPolicyWildcardScanner(ctx.accountId, ctx.credentials, new IamUserPolicyWildcardPolicy(ctx.policyOptions)),
    new AwsAcmCertificateExpiringScanner(ctx.accountId, ctx.credentials, new AcmCertificateExpiringPolicy(ctx.policyOptions)),
    new AwsLambdaFunctionPolicyPublicScanner(ctx.accountId, ctx.credentials, new LambdaFunctionPolicyPublicPolicy(ctx.policyOptions)),
    new AwsSnsTopicPolicyPublicScanner(ctx.accountId, ctx.credentials, new SnsTopicPolicyPublicPolicy(ctx.policyOptions)),
    new AwsSqsQueuePolicyPublicScanner(ctx.accountId, ctx.credentials, new SqsQueuePolicyPublicPolicy(ctx.policyOptions)),
    new AwsEcrRepositoryPolicyPublicScanner(ctx.accountId, ctx.credentials, new EcrRepositoryPolicyPublicPolicy(ctx.policyOptions)),
    new AwsSecretsManagerSecretPolicyPublicScanner(ctx.accountId, ctx.credentials, new SecretsManagerSecretPolicyPublicPolicy(ctx.policyOptions)),
  ];
}

async function defaultCreateAnalysis(ctx: ResourceSecurityAnalysisContext): Promise<ResourceSecurityAnalysis> {
  const scanners = buildScanners({ accountId: ctx.accountId, credentials: ctx.credentials, policyOptions: ctx.policyOptions });
  const kindFilter = ctx.scannerKinds ? new Set(ctx.scannerKinds) : undefined;
  const selected = kindFilter ? scanners.filter((scanner) => kindFilter.has(scanner.kind)) : scanners;
  return { useCase: new FindResourceSecurityFindingsUseCase(selected) };
}

export const defaultResourceSecurityDeps: ResourceSecurityDeps = {
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};
