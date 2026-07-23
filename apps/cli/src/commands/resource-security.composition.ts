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
} from 'resource-security-domain';
import { FindResourceSecurityFindingsUseCase } from 'resource-security-application';
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
} from 'resource-security-infrastructure-aws-adapter';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';

/** Everything a resource-security scanner factory may need to build its instance. */
export interface ResourceSecurityScanContext {
  accountId: string;
  policyOptions: ResourceSecurityPolicyOptions;
}

/**
 * Resolved context passed to `createAnalysis` to build the scanner list.
 * Mirrors `DeadResourceAnalysisContext` (`dead-resources.composition.ts`).
 */
export interface ResourceSecurityAnalysisContext {
  regions: AwsRegion[];
  accountId: string;
  policyOptions: ResourceSecurityPolicyOptions;
  /** Restrict the scan to these kinds (from the wizard). Undefined runs every check. */
  scannerKinds?: ResourceSecurityKind[];
}

export interface ResourceSecurityAnalysis {
  useCase: FindResourceSecurityFindingsUseCasePort;
}

export interface ResourceSecurityDeps {
  resolveAccountId(): Promise<string | undefined>;
  createAnalysis(ctx: ResourceSecurityAnalysisContext): Promise<ResourceSecurityAnalysis>;
}

/** One entry per resource-security kind — same shape as `dead-resources.composition.ts`'s `buildScanners`, 14 entries doesn't warrant a registry split (ADR-0077's threshold was 43). */
function buildScanners(ctx: ResourceSecurityScanContext): ResourceSecurityScannerPort[] {
  return [
    new AwsIamRootMfaDisabledScanner(ctx.accountId, new IamRootMfaDisabledPolicy(ctx.policyOptions)),
    new AwsIamUserMfaDisabledScanner(ctx.accountId, new IamUserMfaDisabledPolicy(ctx.policyOptions)),
    new AwsIamAccessKeyRotationOverdueScanner(ctx.accountId, new IamAccessKeyRotationOverduePolicy(ctx.policyOptions)),
    new AwsIamRootAccessKeyActiveScanner(ctx.accountId, new IamRootAccessKeyActivePolicy(ctx.policyOptions)),
    new AwsIamPasswordPolicyWeakScanner(ctx.accountId, new IamPasswordPolicyWeakPolicy(ctx.policyOptions)),
    new AwsEc2SecurityGroupOpenIngressScanner(ctx.accountId, new Ec2SecurityGroupOpenIngressPolicy(ctx.policyOptions)),
    new AwsEc2DefaultSecurityGroupPermissiveScanner(ctx.accountId, new Ec2DefaultSecurityGroupPermissivePolicy(ctx.policyOptions)),
    new AwsS3BucketPublicScanner(ctx.accountId, new S3BucketPublicPolicy(ctx.policyOptions)),
    new AwsEc2SnapshotPublicScanner(ctx.accountId, new Ec2SnapshotPublicPolicy(ctx.policyOptions)),
    new AwsEc2VolumeUnencryptedScanner(ctx.accountId, new Ec2VolumeUnencryptedPolicy(ctx.policyOptions)),
    new AwsRdsInstanceUnencryptedScanner(ctx.accountId, new RdsInstanceUnencryptedPolicy(ctx.policyOptions)),
    new AwsS3BucketEncryptionMissingScanner(ctx.accountId, new S3BucketEncryptionMissingPolicy(ctx.policyOptions)),
    new AwsRdsInstancePubliclyAccessibleScanner(ctx.accountId, new RdsInstancePubliclyAccessiblePolicy(ctx.policyOptions)),
    new AwsCloudtrailNotMultiregionScanner(ctx.accountId, new CloudtrailNotMultiregionPolicy(ctx.policyOptions)),
  ];
}

async function defaultCreateAnalysis(ctx: ResourceSecurityAnalysisContext): Promise<ResourceSecurityAnalysis> {
  const scanners = buildScanners({ accountId: ctx.accountId, policyOptions: ctx.policyOptions });
  const kindFilter = ctx.scannerKinds ? new Set(ctx.scannerKinds) : undefined;
  const selected = kindFilter ? scanners.filter((scanner) => kindFilter.has(scanner.kind)) : scanners;
  return { useCase: new FindResourceSecurityFindingsUseCase(selected) };
}

export const defaultResourceSecurityDeps: ResourceSecurityDeps = {
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};
