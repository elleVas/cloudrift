// SPDX-License-Identifier: Apache-2.0
import type {
  AwsRegion,
  DeadResourceKind,
  DeadResourcePolicyOptions,
  DeadResourceScannerPort,
  FindDeadResourcesUseCasePort,
} from 'dead-resources-domain';
import {
  Ec2KeyPairUnusedPolicy,
  Ec2RiExpiringSoonPolicy,
  IamUserInactivePolicy,
  IamPolicyUnattachedPolicy,
  IamRoleUnusedPolicy,
  IamAccessKeyStalePolicy,
  Ec2SecurityGroupUnusedPolicy,
  LogsLogGroupEmptyPolicy,
  AcmCertificateUnusedPolicy,
  Route53HostedZoneEmptyPolicy,
  CloudformationStackStuckPolicy,
  S3BucketEmptyPolicy,
  CloudwatchAlarmOrphanedPolicy,
  SnsTopicUnsubscribedPolicy,
  IamInstanceProfileUnattachedPolicy,
  EventbridgeRuleNoTargetsPolicy,
  EcrRepositoryEmptyPolicy,
  StepfunctionsStatemachineUnusedPolicy,
} from 'dead-resources-domain';
import { FindDeadResourcesUseCase } from 'dead-resources-application';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import {
  AwsEc2KeyPairUnusedScanner,
  AwsEc2RiExpiringSoonScanner,
  AwsIamUserInactiveScanner,
  AwsIamPolicyUnattachedScanner,
  AwsIamRoleUnusedScanner,
  AwsIamAccessKeyStaleScanner,
  AwsEc2SecurityGroupUnusedScanner,
  AwsLogsLogGroupEmptyScanner,
  AwsAcmCertificateUnusedScanner,
  AwsRoute53HostedZoneEmptyScanner,
  AwsCloudformationStackStuckScanner,
  AwsS3BucketEmptyScanner,
  AwsCloudwatchAlarmOrphanedScanner,
  AwsSnsTopicUnsubscribedScanner,
  AwsIamInstanceProfileUnattachedScanner,
  AwsEventbridgeRuleNoTargetsScanner,
  AwsEcrRepositoryEmptyScanner,
  AwsStepfunctionsStatemachineUnusedScanner,
} from 'dead-resources-infrastructure-aws-adapter';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';

/** Everything a dead-resource scanner factory may need to build its instance. */
export interface DeadResourceScanContext {
  accountId: string;
  /** Set only when scanning cross-account via --assume-role-arn; undefined uses the ambient credential chain. */
  credentials?: AwsCredentialIdentityProvider;
  policyOptions: DeadResourcePolicyOptions;
}

/**
 * Resolved context passed to `createAnalysis` to build the scanner list.
 * Mirrors `AnalysisContext`/`AnalyzeDeps` (`analyze-waste.composition.ts`,
 * ADR-0078) at a fraction of the size: one scanner, no pricing, no
 * `--live-pricing` gate.
 */
export interface DeadResourceAnalysisContext {
  regions: AwsRegion[];
  accountId: string;
  credentials?: AwsCredentialIdentityProvider;
  policyOptions: DeadResourcePolicyOptions;
  /** Restrict the scan to these kinds (from the wizard). Undefined runs every check. */
  scannerKinds?: DeadResourceKind[];
}

export interface DeadResourceAnalysis {
  useCase: FindDeadResourcesUseCasePort;
}

export interface DeadResourcesDeps {
  resolveAccountId(credentials?: AwsCredentialIdentityProvider): Promise<string | undefined>;
  createAnalysis(ctx: DeadResourceAnalysisContext): Promise<DeadResourceAnalysis>;
}

/**
 * One entry per dead-resource kind — same shape as `ALWAYS_ON_SCANNERS`
 * (`scanner-registry.ts`), just not yet split into its own file: at 18
 * entries this still has nothing to earn a split against (see ADR-0077's
 * reasoning for why the cost-waste registry was split where it was, not
 * preemptively — that was 43 entries).
 */
function buildScanners(ctx: DeadResourceScanContext): DeadResourceScannerPort[] {
  return [
    new AwsEc2KeyPairUnusedScanner(ctx.accountId, ctx.credentials, new Ec2KeyPairUnusedPolicy(ctx.policyOptions)),
    new AwsEc2RiExpiringSoonScanner(ctx.accountId, ctx.credentials, new Ec2RiExpiringSoonPolicy(ctx.policyOptions)),
    new AwsIamUserInactiveScanner(ctx.accountId, ctx.credentials, new IamUserInactivePolicy(ctx.policyOptions)),
    new AwsIamPolicyUnattachedScanner(ctx.accountId, ctx.credentials, new IamPolicyUnattachedPolicy(ctx.policyOptions)),
    new AwsIamRoleUnusedScanner(ctx.accountId, ctx.credentials, new IamRoleUnusedPolicy(ctx.policyOptions)),
    new AwsIamAccessKeyStaleScanner(ctx.accountId, ctx.credentials, new IamAccessKeyStalePolicy(ctx.policyOptions)),
    new AwsEc2SecurityGroupUnusedScanner(ctx.accountId, ctx.credentials, new Ec2SecurityGroupUnusedPolicy(ctx.policyOptions)),
    new AwsLogsLogGroupEmptyScanner(ctx.accountId, ctx.credentials, new LogsLogGroupEmptyPolicy(ctx.policyOptions)),
    new AwsAcmCertificateUnusedScanner(ctx.accountId, ctx.credentials, new AcmCertificateUnusedPolicy(ctx.policyOptions)),
    new AwsRoute53HostedZoneEmptyScanner(ctx.accountId, ctx.credentials, new Route53HostedZoneEmptyPolicy(ctx.policyOptions)),
    new AwsCloudformationStackStuckScanner(ctx.accountId, ctx.credentials, new CloudformationStackStuckPolicy(ctx.policyOptions)),
    new AwsS3BucketEmptyScanner(ctx.accountId, ctx.credentials, new S3BucketEmptyPolicy(ctx.policyOptions)),
    new AwsCloudwatchAlarmOrphanedScanner(ctx.accountId, ctx.credentials, new CloudwatchAlarmOrphanedPolicy(ctx.policyOptions)),
    new AwsSnsTopicUnsubscribedScanner(ctx.accountId, ctx.credentials, new SnsTopicUnsubscribedPolicy(ctx.policyOptions)),
    new AwsIamInstanceProfileUnattachedScanner(ctx.accountId, ctx.credentials, new IamInstanceProfileUnattachedPolicy(ctx.policyOptions)),
    new AwsEventbridgeRuleNoTargetsScanner(ctx.accountId, ctx.credentials, new EventbridgeRuleNoTargetsPolicy(ctx.policyOptions)),
    new AwsEcrRepositoryEmptyScanner(ctx.accountId, ctx.credentials, new EcrRepositoryEmptyPolicy(ctx.policyOptions)),
    new AwsStepfunctionsStatemachineUnusedScanner(ctx.accountId, ctx.credentials, new StepfunctionsStatemachineUnusedPolicy(ctx.policyOptions)),
  ];
}

async function defaultCreateAnalysis(ctx: DeadResourceAnalysisContext): Promise<DeadResourceAnalysis> {
  const scanners = buildScanners({ accountId: ctx.accountId, credentials: ctx.credentials, policyOptions: ctx.policyOptions });
  const kindFilter = ctx.scannerKinds ? new Set(ctx.scannerKinds) : undefined;
  const selected = kindFilter ? scanners.filter((scanner) => kindFilter.has(scanner.kind)) : scanners;
  return { useCase: new FindDeadResourcesUseCase(selected) };
}

export const defaultDeadResourcesDeps: DeadResourcesDeps = {
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};
