// SPDX-License-Identifier: Apache-2.0
import {
  EbsVolumeWastePolicy,
  ElasticIpWastePolicy,
  RdsInstanceWastePolicy,
  LoadBalancerWastePolicy,
  Ec2InstanceWastePolicy,
  EbsSnapshotWastePolicy,
  NatGatewayWastePolicy,
  EbsGp2UpgradePolicy,
  EbsIdlePolicy,
  LogGroupWastePolicy,
  OrphanedEniWastePolicy,
  S3NoLifecyclePolicy,
  LambdaUnderutilizedPolicy,
  EfsUnusedPolicy,
  DynamoDbOverprovisionedPolicy,
  FsxIdleFilesystemPolicy,
  VpnConnectionIdlePolicy,
  TransitGatewayIdleAttachmentPolicy,
  KinesisProvisionedIdleStreamPolicy,
  SqsDlqAbandonedWastePolicy,
  LambdaLogGroupOrphanedPolicy,
  AuroraServerlessOverprovisionedPolicy,
  SageMakerTrainingOrphanedPolicy,
  EnvironmentGhostPolicy,
  EksOrphanPvcPolicy,
  AmiUnusedPolicy,
  EcrImageUntaggedPolicy,
  S3MultipartUploadAbandonedPolicy,
  RdsManualSnapshotOldPolicy,
  SecretsManagerUnusedPolicy,
  CodepipelinePipelineStalePolicy,
} from 'cloud-cost-domain';
import {
  AwsEbsVolumeScanner,
  AwsElasticIpScanner,
  AwsRdsInstanceScanner,
  AwsLoadBalancerScanner,
  AwsEc2InstanceScanner,
  AwsEbsSnapshotScanner,
  AwsNatGatewayScanner,
  AwsGp2UpgradeScanner,
  AwsEbsIdleScanner,
  AwsLogGroupScanner,
  AwsEniOrphanedScanner,
  AwsS3NoLifecycleScanner,
  AwsLambdaUnderutilizedScanner,
  AwsEfsUnusedScanner,
  AwsDynamoDbOverprovisionedScanner,
  AwsFsxIdleScanner,
  AwsVpnConnectionIdleScanner,
  AwsTransitGatewayIdleScanner,
  AwsKinesisIdleScanner,
  AwsSqsDlqAbandonedScanner,
  AwsLambdaLogGroupOrphanedScanner,
  AwsAuroraServerlessIdleScanner,
  AwsSageMakerTrainingOrphanedScanner,
  AwsEnvironmentGhostScanner,
  AwsEksOrphanPvcScanner,
  AwsAmiUnusedScanner,
  AwsEcrImageUntaggedScanner,
  AwsS3MultipartUploadAbandonedScanner,
  AwsRdsManualSnapshotOldScanner,
  AwsSecretsManagerUnusedScanner,
  AwsCodepipelinePipelineStaleScanner,
} from 'cloud-cost-infrastructure-aws-adapter';
import type { ScannerBuildContext, ScannerRegistration } from './scanner-registry';

/**
 * Resource kinds with a static, low-cardinality price (or $0 hygiene flags)
 * that never need `--live-pricing`. See {@link LIVE_PRICING_SCANNERS} in
 * `./live-pricing-scanners` for the per-instance-type-priced counterpart.
 */
// `ctx.credentials` (set only for --assume-role-arn cross-account scans)
// slots in at a different position per scanner: "flat" scanners take it
// right after `ctx.accountId` (before the policy); `CloudWatchIdleScanner`
// subclasses take it as their own LAST constructor param (forwarded to the
// shared base class), so it's appended after their other args instead.
export const ALWAYS_ON_SCANNERS: ScannerRegistration<ScannerBuildContext>[] = [
  {
    kind: 'ebs-volume',
    create: (ctx) =>
      new AwsEbsVolumeScanner(ctx.pricing, ctx.accountId, ctx.credentials, new EbsVolumeWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'elastic-ip',
    create: (ctx) =>
      new AwsElasticIpScanner(ctx.pricing, ctx.accountId, ctx.credentials, new ElasticIpWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'rds-instance',
    create: (ctx) =>
      new AwsRdsInstanceScanner(ctx.pricing, ctx.accountId, ctx.credentials, new RdsInstanceWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'load-balancer',
    create: (ctx) =>
      new AwsLoadBalancerScanner(ctx.pricing, ctx.accountId, ctx.credentials, new LoadBalancerWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'ec2-instance',
    create: (ctx) =>
      new AwsEc2InstanceScanner(ctx.pricing, ctx.accountId, ctx.credentials, new Ec2InstanceWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'ebs-snapshot',
    create: (ctx) =>
      new AwsEbsSnapshotScanner(ctx.pricing, ctx.accountId, ctx.credentials, new EbsSnapshotWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'nat-gateway',
    create: (ctx) =>
      new AwsNatGatewayScanner(
        ctx.pricing,
        ctx.accountId,
        new NatGatewayWastePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'ebs-gp2-upgrade',
    create: (ctx) =>
      new AwsGp2UpgradeScanner(ctx.pricing, ctx.accountId, ctx.credentials, new EbsGp2UpgradePolicy(ctx.policyOptions)),
  },
  {
    kind: 'ebs-idle',
    create: (ctx) =>
      new AwsEbsIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new EbsIdlePolicy(ctx.policyOptions, ctx.config.thresholds?.ebsIdleMaxOps ?? 0),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'log-group',
    create: (ctx) =>
      new AwsLogGroupScanner(ctx.pricing, ctx.accountId, ctx.credentials, new LogGroupWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'eni-orphaned',
    create: (ctx) => new AwsEniOrphanedScanner(ctx.accountId, ctx.credentials, new OrphanedEniWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 's3-no-lifecycle',
    create: (ctx) =>
      new AwsS3NoLifecycleScanner(ctx.accountId, ctx.credentials, new S3NoLifecyclePolicy(ctx.policyOptions)),
  },
  {
    kind: 'lambda-underutilized',
    create: (ctx) =>
      new AwsLambdaUnderutilizedScanner(
        ctx.accountId,
        new LambdaUnderutilizedPolicy(ctx.policyOptions, ctx.config.thresholds?.lambdaInvocationsMin ?? 0),
        ctx.utilizationWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'efs-unused',
    create: (ctx) =>
      new AwsEfsUnusedScanner(
        ctx.pricing,
        ctx.accountId,
        new EfsUnusedPolicy(ctx.policyOptions, ctx.config.thresholds?.efsIoBytesMin ?? 0),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'dynamodb-overprovisioned',
    create: (ctx) =>
      new AwsDynamoDbOverprovisionedScanner(
        ctx.pricing,
        ctx.accountId,
        new DynamoDbOverprovisionedPolicy(
          ctx.policyOptions,
          ctx.config.thresholds?.dynamoCapacityUtilizationPercent ?? 10,
        ),
        ctx.utilizationWindowHours,
        ctx.credentials,
      ),
  },
  // Phase 5.5 (ADR-0038): low-cardinality fixed-SKU prices, always-on like
  // the scanners above (ADR-0037).
  {
    kind: 'fsx-idle-filesystem',
    create: (ctx) =>
      new AwsFsxIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new FsxIdleFilesystemPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'vpn-connection-idle',
    create: (ctx) =>
      new AwsVpnConnectionIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new VpnConnectionIdlePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'transit-gateway-idle-attachment',
    create: (ctx) =>
      new AwsTransitGatewayIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new TransitGatewayIdleAttachmentPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  {
    kind: 'kinesis-provisioned-idle-stream',
    create: (ctx) =>
      new AwsKinesisIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new KinesisProvisionedIdleStreamPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
        ctx.credentials,
      ),
  },
  // Phase 6.1 (ADR-0065): serverless orphans vertical.
  {
    kind: 'sqs-dlq-abandoned',
    create: (ctx) =>
      new AwsSqsDlqAbandonedScanner(
        ctx.accountId,
        new SqsDlqAbandonedWastePolicy(ctx.policyOptions),
        undefined,
        ctx.credentials,
      ),
  },
  {
    kind: 'lambda-loggroup-orphaned',
    create: (ctx) =>
      new AwsLambdaLogGroupOrphanedScanner(
        ctx.pricing,
        ctx.accountId,
        ctx.credentials,
        new LambdaLogGroupOrphanedPolicy(ctx.policyOptions),
      ),
  },
  // Phase 6.2 (ADR-0065): Aurora Serverless v2 vertical. Static flat ACU-hour
  // price, so always-on (ADR-0037); uses the longer utilization window (peak,
  // not zero-activity), like the CPU-underutilized scanners.
  {
    kind: 'aurora-serverless-overprovisioned',
    create: (ctx) =>
      new AwsAuroraServerlessIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new AuroraServerlessOverprovisionedPolicy(
          ctx.policyOptions,
          ctx.config.thresholds?.auroraMinAcuUtilizationPercent ?? 50,
        ),
        ctx.utilizationWindowHours,
        ctx.credentials,
      ),
  },
  // Phase 6.3 (ADR-0065): SageMaker vertical. A model's own cost is $0 and
  // stays $0 (no basis for a dollar estimate — see entity doc); always-on
  // like lambda-loggroup-orphaned, a pure namespace-hygiene flag.
  {
    kind: 'sagemaker-training-orphaned',
    create: (ctx) =>
      new AwsSageMakerTrainingOrphanedScanner(
        ctx.accountId,
        ctx.credentials,
        new SageMakerTrainingOrphanedPolicy(ctx.policyOptions),
      ),
  },
  // Phase 6.4 (ADR-0065): Dev/PR ghost environments. $0 hygiene flag (see
  // EnvironmentGhost), so always-on like sqs-dlq-abandoned/eni-orphaned.
  {
    kind: 'environment-ghost',
    create: (ctx) => {
      const inactivityDays = ctx.config.environmentDetection?.inactivityDays ?? 7;
      return new AwsEnvironmentGhostScanner(
        ctx.accountId,
        ctx.credentials,
        new EnvironmentGhostPolicy(ctx.policyOptions, inactivityDays),
        ctx.config.environmentDetection?.tagKeys,
        ctx.config.environmentDetection?.namingPatterns,
        inactivityDays,
      );
    },
  },
  // Phase 6.5 (ADR-0065/ADR-0066): EKS cost visibility vertical. Static EBS
  // pricing, so always-on (ADR-0037) — pairs with eks-node-overprovisioned above.
  {
    kind: 'eks-orphan-pvc',
    create: (ctx) =>
      new AwsEksOrphanPvcScanner(ctx.pricing, ctx.accountId, ctx.credentials, new EksOrphanPvcPolicy(ctx.policyOptions)),
  },
  // Added 2026-07-22: all fixed at-rest cost, always-on like the rest of
  // the EC2/S3/RDS scanners above.
  {
    kind: 'ami-unused',
    create: (ctx) =>
      new AwsAmiUnusedScanner(ctx.pricing, ctx.accountId, ctx.credentials, new AmiUnusedPolicy(ctx.policyOptions)),
  },
  {
    kind: 'ecr-image-untagged',
    create: (ctx) =>
      new AwsEcrImageUntaggedScanner(ctx.pricing, ctx.accountId, ctx.credentials, new EcrImageUntaggedPolicy(ctx.policyOptions)),
  },
  {
    kind: 's3-multipart-upload-abandoned',
    create: (ctx) =>
      new AwsS3MultipartUploadAbandonedScanner(
        ctx.pricing,
        ctx.accountId,
        ctx.credentials,
        new S3MultipartUploadAbandonedPolicy(ctx.policyOptions),
      ),
  },
  {
    kind: 'rds-manual-snapshot-old',
    create: (ctx) =>
      new AwsRdsManualSnapshotOldScanner(
        ctx.pricing,
        ctx.accountId,
        ctx.credentials,
        new RdsManualSnapshotOldPolicy(ctx.policyOptions),
      ),
  },
  {
    kind: 'secretsmanager-unused',
    create: (ctx) =>
      new AwsSecretsManagerUnusedScanner(
        ctx.pricing,
        ctx.accountId,
        ctx.credentials,
        new SecretsManagerUnusedPolicy(ctx.policyOptions),
      ),
  },
  // Added 2026-07-23: flat $1/mo-per-pipeline fixed cost (ADR-0037 criteria),
  // moved here from the dead-resources candidate list — see wasted-resource.ts.
  {
    kind: 'codepipeline-pipeline-stale',
    create: (ctx) =>
      new AwsCodepipelinePipelineStaleScanner(
        ctx.pricing,
        ctx.accountId,
        ctx.credentials,
        new CodepipelinePipelineStalePolicy(ctx.policyOptions),
      ),
  },
];
