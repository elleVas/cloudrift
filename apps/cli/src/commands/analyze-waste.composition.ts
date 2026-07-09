// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import type { Result } from 'shared-kernel';
import {
  EbsVolumeWastePolicy,
  ElasticIpWastePolicy,
  RdsInstanceWastePolicy,
  LoadBalancerWastePolicy,
  Ec2InstanceWastePolicy,
  EbsSnapshotWastePolicy,
  NatGatewayWastePolicy,
  Gp2UpgradePolicy,
  EbsIdlePolicy,
  Ec2UnderutilizedPolicy,
  RdsUnderutilizedPolicy,
  LogGroupWastePolicy,
  OrphanedEniWastePolicy,
  S3NoLifecyclePolicy,
  LambdaUnderutilizedPolicy,
  EfsUnusedPolicy,
  DynamoDbOverprovisionedPolicy,
  ElastiCacheIdlePolicy,
  RedshiftIdleClusterPolicy,
  OpenSearchIdleDomainPolicy,
  MskIdleClusterPolicy,
  FsxIdleFilesystemPolicy,
  DocumentDbIdleInstancePolicy,
  NeptuneIdleInstancePolicy,
  MqIdleBrokerPolicy,
  WorkspacesIdlePolicy,
  VpnConnectionIdlePolicy,
  TransitGatewayIdleAttachmentPolicy,
  KinesisProvisionedIdleStreamPolicy,
  RESOURCE_KINDS,
} from 'cloud-cost-domain';
import type {
  AwsRegion,
  FindWastedResourcesUseCasePort,
  PricingPort,
  ResourceKind,
  WastePolicyOptions,
  WasteScannerPort,
} from 'cloud-cost-domain';
import { AnalyzeCloudWasteUseCase } from 'cloud-cost-application';
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
  AwsEc2UnderutilizedScanner,
  AwsRdsUnderutilizedScanner,
  AwsLogGroupScanner,
  AwsEniOrphanedScanner,
  AwsS3NoLifecycleScanner,
  AwsLambdaUnderutilizedScanner,
  AwsEfsUnusedScanner,
  AwsDynamoDbOverprovisionedScanner,
  AwsElastiCacheIdleScanner,
  AwsRedshiftIdleScanner,
  AwsOpenSearchIdleScanner,
  AwsMskIdleScanner,
  AwsFsxIdleScanner,
  AwsDocumentDbIdleScanner,
  AwsNeptuneIdleScanner,
  AwsMqIdleScanner,
  AwsWorkspacesIdleScanner,
  AwsVpnConnectionIdleScanner,
  AwsTransitGatewayIdleScanner,
  AwsKinesisIdleScanner,
  StaticPriceTableAdapter,
  TablePricingAdapter,
  AwsPricingApiAdapter,
  BUILTIN_PRICE_TABLE,
  BUILTIN_PRICES_AS_OF,
  mergePriceTables,
  resolveAwsAccountId,
} from 'cloud-cost-infrastructure-aws-adapter';
import type { PriceTable } from 'cloud-cost-infrastructure-aws-adapter';
import { loadConfig, type CloudriftConfig, type ConfigError } from '../config/cloudrift.config';

/** Resolved context passed to `createAnalysis` to build pricing + scanners. */
export interface AnalysisContext {
  regions: AwsRegion[];
  config: CloudriftConfig;
  accountId: string;
  livePricing: boolean;
  policyOptions: WastePolicyOptions;
  cloudwatchWindowHours: number;
  utilizationWindowHours: number;
  info: (msg: string) => void;
  /** Restrict the scan to these kinds (from --scanners, --all-services, or the wizard). Undefined runs every scanner. */
  scannerKinds?: ResourceKind[];
}

export interface Analysis {
  useCase: FindWastedResourcesUseCasePort;
  pricesAsOf: string;
}

/**
 * Injection seam: everything that touches AWS passes through here. The default
 * composes the real scanners; the CLI tests inject fakes to verify format, exit
 * code, and stdout routing without AWS credentials.
 */
export interface AnalyzeDeps {
  loadConfig(cwd: string, explicitPath?: string): Promise<Result<CloudriftConfig, ConfigError>>;
  resolveAccountId(): Promise<string | undefined>;
  createAnalysis(ctx: AnalysisContext): Promise<Analysis>;
}

interface BuiltPricing {
  pricing: PricingPort;
  livePricingAdapter?: AwsPricingApiAdapter;
}

/**
 * Layered pricing: static price list (base) ← live AWS Pricing API (--live-pricing)
 * ← user overrides (config.prices, take precedence).
 */
async function buildPricing(ctx: AnalysisContext): Promise<BuiltPricing> {
  let priceTable: PriceTable = BUILTIN_PRICE_TABLE;
  let pricesAsOf = BUILTIN_PRICES_AS_OF;
  let layered = false;
  // The EC2 underutilized scanner resolves the on-demand per-instance-type price
  // from the same AwsPricingApiAdapter instance: without --live-pricing there is
  // no price per instance type, so the scanner is not registered.
  let livePricingAdapter: AwsPricingApiAdapter | undefined;

  if (ctx.livePricing) {
    ctx.info(chalk.dim('  Fetching current prices from the AWS Pricing API...'));
    livePricingAdapter = new AwsPricingApiAdapter();
    const live = await livePricingAdapter.warmUp(ctx.regions);
    if (live.ok) {
      priceTable = mergePriceTables(priceTable, live.value);
      pricesAsOf = new Date().toISOString().slice(0, 7); // YYYY-MM
      layered = true;
    } else {
      ctx.info(
        chalk.yellow(
          `  Live pricing unavailable (${live.error.message}); using the static price table.`,
        ),
      );
    }
  }

  if (ctx.config.prices) {
    priceTable = mergePriceTables(priceTable, ctx.config.prices);
    pricesAsOf = `${pricesAsOf} + custom overrides`;
    layered = true;
  }

  const pricing: PricingPort = layered
    ? new TablePricingAdapter(priceTable, pricesAsOf)
    : new StaticPriceTableAdapter();

  return { pricing, livePricingAdapter };
}

/** Everything an always-on scanner factory may need to build its instance. */
interface ScannerBuildContext {
  pricing: PricingPort;
  accountId: string;
  policyOptions: WastePolicyOptions;
  cloudwatchWindowHours: number;
  utilizationWindowHours: number;
  config: CloudriftConfig;
}

/** Same as above, plus the adapter only scanners gated on --live-pricing may use. */
interface LivePricingScannerBuildContext extends ScannerBuildContext {
  livePricingAdapter: AwsPricingApiAdapter;
}

interface ScannerRegistration<Ctx> {
  kind: ResourceKind;
  create: (ctx: Ctx) => WasteScannerPort;
}

/**
 * One entry per always-on resource kind. Adding a scanner means adding one
 * entry here — `buildScanners` below is a plain map over this array (plus
 * {@link LIVE_PRICING_SCANNERS}), not a growing sequence of `push` calls.
 */
export const ALWAYS_ON_SCANNERS: ScannerRegistration<ScannerBuildContext>[] = [
  {
    kind: 'ebs-volume',
    create: (ctx) => new AwsEbsVolumeScanner(ctx.pricing, ctx.accountId, new EbsVolumeWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'elastic-ip',
    create: (ctx) => new AwsElasticIpScanner(ctx.pricing, ctx.accountId, new ElasticIpWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'rds-instance',
    create: (ctx) =>
      new AwsRdsInstanceScanner(ctx.pricing, ctx.accountId, new RdsInstanceWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'load-balancer',
    create: (ctx) =>
      new AwsLoadBalancerScanner(ctx.pricing, ctx.accountId, new LoadBalancerWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'ec2-instance',
    create: (ctx) => new AwsEc2InstanceScanner(ctx.pricing, ctx.accountId, new Ec2InstanceWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'ebs-snapshot',
    create: (ctx) =>
      new AwsEbsSnapshotScanner(ctx.pricing, ctx.accountId, new EbsSnapshotWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'nat-gateway',
    create: (ctx) =>
      new AwsNatGatewayScanner(
        ctx.pricing,
        ctx.accountId,
        new NatGatewayWastePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'ebs-gp2-upgrade',
    create: (ctx) => new AwsGp2UpgradeScanner(ctx.pricing, ctx.accountId, new Gp2UpgradePolicy(ctx.policyOptions)),
  },
  {
    kind: 'ebs-idle',
    create: (ctx) =>
      new AwsEbsIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new EbsIdlePolicy(ctx.policyOptions, ctx.config.thresholds?.ebsIdleMaxOps ?? 0),
        ctx.cloudwatchWindowHours,
      ),
  },
  {
    kind: 'log-group',
    create: (ctx) => new AwsLogGroupScanner(ctx.pricing, ctx.accountId, new LogGroupWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 'eni-orphaned',
    create: (ctx) => new AwsEniOrphanedScanner(ctx.accountId, new OrphanedEniWastePolicy(ctx.policyOptions)),
  },
  {
    kind: 's3-no-lifecycle',
    create: (ctx) =>
      new AwsS3NoLifecycleScanner(ctx.pricing, ctx.accountId, new S3NoLifecyclePolicy(ctx.policyOptions)),
  },
  {
    kind: 'lambda-underutilized',
    create: (ctx) =>
      new AwsLambdaUnderutilizedScanner(
        ctx.accountId,
        new LambdaUnderutilizedPolicy(ctx.policyOptions, ctx.config.thresholds?.lambdaInvocationsMin ?? 0),
        ctx.utilizationWindowHours,
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
      ),
  },
  // Phase 5.5 (ADR-0038): low-cardinality fixed-SKU prices, always-on like
  // the scanners above (ADR-0037).
  {
    kind: 'fsx-idle-filesystem',
    create: (ctx) =>
      new AwsFsxIdleScanner(ctx.pricing, ctx.accountId, new FsxIdleFilesystemPolicy(ctx.policyOptions), ctx.cloudwatchWindowHours),
  },
  {
    kind: 'vpn-connection-idle',
    create: (ctx) =>
      new AwsVpnConnectionIdleScanner(
        ctx.pricing,
        ctx.accountId,
        new VpnConnectionIdlePolicy(ctx.policyOptions),
        ctx.cloudwatchWindowHours,
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
      ),
  },
];

// Gated on --live-pricing: the price per instance type/RDS class/ElastiCache
// node type isn't in the static price list (cardinality too high), so without
// live prices there's no estimable saving and the scanners remain disabled
// (EC2/RDS are advisory; ElastiCache is definite waste once the price is
// known, but it's still gated on the same resource).
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
];

/**
 * Fails fast at module load if a resource kind is missing/duplicated across
 * the two registries — the failure mode a hand-written composition root can't catch.
 */
function assertRegistryMatchesResourceKinds(): void {
  const registered = [...ALWAYS_ON_SCANNERS, ...LIVE_PRICING_SCANNERS].map((r) => r.kind);
  const missing = RESOURCE_KINDS.filter((k) => !registered.includes(k));
  const duplicates = registered.filter((k, i) => registered.indexOf(k) !== i);
  if (missing.length > 0 || duplicates.length > 0) {
    throw new Error(
      `Scanner registry is out of sync with RESOURCE_KINDS` +
        (missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '') +
        (duplicates.length > 0 ? ` (duplicated: ${duplicates.join(', ')})` : ''),
    );
  }
}
assertRegistryMatchesResourceKinds();

/** Always-on scanners + advisory scanners gated on --live-pricing. */
export function buildScanners(
  ctx: ScannerBuildContext,
  livePricingAdapter: AwsPricingApiAdapter | undefined,
): WasteScannerPort[] {
  const scanners = ALWAYS_ON_SCANNERS.map((reg) => reg.create(ctx));
  if (livePricingAdapter) {
    scanners.push(...LIVE_PRICING_SCANNERS.map((reg) => reg.create({ ...ctx, livePricingAdapter })));
  }
  return scanners;
}

/** Real composition: layered pricing + AWS scanners (one advisory, gated on --live-pricing) + generic use case. */
async function defaultCreateAnalysis(ctx: AnalysisContext): Promise<Analysis> {
  const { pricing, livePricingAdapter } = await buildPricing(ctx);
  const scanners = buildScanners(
    {
      pricing,
      accountId: ctx.accountId,
      policyOptions: ctx.policyOptions,
      cloudwatchWindowHours: ctx.cloudwatchWindowHours,
      utilizationWindowHours: ctx.utilizationWindowHours,
      config: ctx.config,
    },
    livePricingAdapter,
  );
  // No re-validation here: ctx.scannerKinds is only ever set by
  // analyze-waste.command.ts, which already validates it (--scanners against
  // RESOURCE_KINDS, or the wizard/--all-services, which can't produce an
  // unknown kind). This function has no other caller.
  const kindFilter = ctx.scannerKinds ? new Set(ctx.scannerKinds) : undefined;
  const selected = kindFilter ? scanners.filter((scanner) => kindFilter.has(scanner.kind)) : scanners;
  return { useCase: new AnalyzeCloudWasteUseCase(selected), pricesAsOf: pricing.getPricesAsOf() };
}

export const defaultAnalyzeDeps: AnalyzeDeps = {
  loadConfig,
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};
