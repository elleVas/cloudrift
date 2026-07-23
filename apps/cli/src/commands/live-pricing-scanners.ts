// SPDX-License-Identifier: Apache-2.0
import {
  Ec2UnderutilizedPolicy,
  RdsUnderutilizedPolicy,
  ElastiCacheIdlePolicy,
  RedshiftIdleClusterPolicy,
  OpenSearchIdleDomainPolicy,
  MskIdleClusterPolicy,
  DocumentDbIdleInstancePolicy,
  NeptuneIdleInstancePolicy,
  MqIdleBrokerPolicy,
  WorkspacesIdlePolicy,
  SageMakerNotebookIdlePolicy,
  SageMakerEndpointIdlePolicy,
  EksNodeOverprovisionedPolicy,
} from 'cloud-cost-domain';
import {
  AwsEc2UnderutilizedScanner,
  AwsRdsUnderutilizedScanner,
  AwsElastiCacheIdleScanner,
  AwsRedshiftIdleScanner,
  AwsOpenSearchIdleScanner,
  AwsMskIdleScanner,
  AwsDocumentDbIdleScanner,
  AwsNeptuneIdleScanner,
  AwsMqIdleScanner,
  AwsWorkspacesIdleScanner,
  AwsSageMakerNotebookIdleScanner,
  AwsSageMakerEndpointIdleScanner,
  AwsEksNodeOverprovisionedScanner,
} from 'cloud-cost-infrastructure-aws-adapter';
import type { LivePricingScannerBuildContext, ScannerRegistration } from './scanner-registry';

// Gated on --live-pricing: the price per instance type/RDS class/ElastiCache
// node type isn't in the static price list (cardinality too high), so without
// live prices there's no estimable saving and the scanners remain disabled
// (EC2/RDS are advisory; ElastiCache is definite waste once the price is
// known, but it's still gated on the same resource). See
// {@link ALWAYS_ON_SCANNERS} in `./always-on-scanners` for the statically
// priced counterpart.
export const LIVE_PRICING_SCANNERS: ScannerRegistration<LivePricingScannerBuildContext>[] = [
  {
    kind: 'ec2-underutilized',
    create: (ctx) =>
      new AwsEc2UnderutilizedScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new Ec2UnderutilizedPolicy(ctx.policyOptions, ctx.config.thresholds?.ec2CpuPercent ?? 5),
        ctx.utilizationWindowHours,
      ),
  },
  {
    kind: 'rds-underutilized',
    create: (ctx) =>
      new AwsRdsUnderutilizedScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new RdsUnderutilizedPolicy(ctx.policyOptions, ctx.config.thresholds?.rdsCpuPercent ?? 5),
        ctx.utilizationWindowHours,
      ),
  },
  {
    kind: 'elasticache-idle',
    create: (ctx) =>
      new AwsElastiCacheIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new ElastiCacheIdlePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  // Phase 5.5 (ADR-0038): per-instance/node/broker-type pricing, same
  // reasoning as EC2/RDS/ElastiCache above (ADR-0037).
  {
    kind: 'redshift-idle-cluster',
    create: (ctx) =>
      new AwsRedshiftIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new RedshiftIdleClusterPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'opensearch-idle-domain',
    create: (ctx) =>
      new AwsOpenSearchIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new OpenSearchIdleDomainPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'msk-idle-cluster',
    create: (ctx) =>
      new AwsMskIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new MskIdleClusterPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'documentdb-idle-instance',
    create: (ctx) =>
      new AwsDocumentDbIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new DocumentDbIdleInstancePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'neptune-idle-instance',
    create: (ctx) =>
      new AwsNeptuneIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new NeptuneIdleInstancePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'mq-idle-broker',
    create: (ctx) =>
      new AwsMqIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new MqIdleBrokerPolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'workspaces-idle',
    create: (ctx) =>
      new AwsWorkspacesIdleScanner(ctx.livePricingAdapter, ctx.accountId, new WorkspacesIdlePolicy(ctx.policyOptions)),
  },
  // Phase 6.3 (ADR-0065): SageMaker vertical. Per-instance-type pricing, same
  // reasoning as EC2/RDS/ElastiCache above (ADR-0037).
  {
    kind: 'sagemaker-notebook-idle',
    create: (ctx) =>
      new AwsSageMakerNotebookIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new SageMakerNotebookIdlePolicy(ctx.policyOptions, ctx.config.thresholds?.sagemakerNotebookCpuPercent ?? 2),
        ctx.utilizationWindowHours,
      ),
  },
  {
    kind: 'sagemaker-endpoint-idle',
    create: (ctx) =>
      new AwsSageMakerEndpointIdleScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new SageMakerEndpointIdlePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  // Phase 6.5 (ADR-0065/ADR-0066): EKS cost visibility vertical. Per-instance-
  // type pricing, same reasoning as EC2/RDS/SageMaker above (ADR-0037).
  {
    kind: 'eks-node-overprovisioned',
    create: (ctx) =>
      new AwsEksNodeOverprovisionedScanner(
        ctx.livePricingAdapter,
        ctx.accountId,
        new EksNodeOverprovisionedPolicy(ctx.policyOptions, ctx.config.thresholds?.eksNodeUtilizationPercent ?? 30),
        ctx.utilizationWindowHours,
      ),
  },
];
