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
} from 'cloud-cost-domain';
import type {
  AwsRegion,
  FindWastedResourcesUseCasePort,
  PricingPort,
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

/** Always-on scanners + advisory scanners gated on --live-pricing. */
function buildScanners(
  ctx: AnalysisContext,
  pricing: PricingPort,
  livePricingAdapter: AwsPricingApiAdapter | undefined,
): WasteScannerPort[] {
  const { policyOptions, accountId, cloudwatchWindowHours, utilizationWindowHours } = ctx;
  const scanners: WasteScannerPort[] = [
    new AwsEbsVolumeScanner(pricing, accountId, new EbsVolumeWastePolicy(policyOptions)),
    new AwsElasticIpScanner(pricing, accountId, new ElasticIpWastePolicy(policyOptions)),
    new AwsRdsInstanceScanner(pricing, accountId, new RdsInstanceWastePolicy(policyOptions)),
    new AwsLoadBalancerScanner(pricing, accountId, new LoadBalancerWastePolicy(policyOptions)),
    new AwsEc2InstanceScanner(pricing, accountId, new Ec2InstanceWastePolicy(policyOptions)),
    new AwsEbsSnapshotScanner(pricing, accountId, new EbsSnapshotWastePolicy(policyOptions)),
    new AwsNatGatewayScanner(
      pricing,
      accountId,
      new NatGatewayWastePolicy(policyOptions),
      cloudwatchWindowHours,
    ),
    new AwsGp2UpgradeScanner(pricing, accountId, new Gp2UpgradePolicy(policyOptions)),
    new AwsEbsIdleScanner(
      pricing,
      accountId,
      new EbsIdlePolicy(policyOptions, ctx.config.thresholds?.ebsIdleMaxOps ?? 0),
      cloudwatchWindowHours,
    ),
    new AwsLogGroupScanner(pricing, accountId, new LogGroupWastePolicy(policyOptions)),
    new AwsEniOrphanedScanner(accountId, new OrphanedEniWastePolicy(policyOptions)),
    new AwsS3NoLifecycleScanner(pricing, accountId, new S3NoLifecyclePolicy(policyOptions)),
    new AwsLambdaUnderutilizedScanner(
      accountId,
      new LambdaUnderutilizedPolicy(policyOptions, ctx.config.thresholds?.lambdaInvocationsMin ?? 0),
      utilizationWindowHours,
    ),
    new AwsEfsUnusedScanner(
      pricing,
      accountId,
      new EfsUnusedPolicy(policyOptions, ctx.config.thresholds?.efsIoBytesMin ?? 0),
      cloudwatchWindowHours,
    ),
    new AwsDynamoDbOverprovisionedScanner(
      pricing,
      accountId,
      new DynamoDbOverprovisionedPolicy(
        policyOptions,
        ctx.config.thresholds?.dynamoCapacityUtilizationPercent ?? 10,
      ),
      utilizationWindowHours,
    ),
    // Phase 5.5 (ADR-0038): low-cardinality fixed-SKU prices, always-on like
    // the scanners above (ADR-0037).
    new AwsFsxIdleScanner(pricing, accountId, new FsxIdleFilesystemPolicy(policyOptions), cloudwatchWindowHours),
    new AwsVpnConnectionIdleScanner(
      pricing,
      accountId,
      new VpnConnectionIdlePolicy(policyOptions),
      cloudwatchWindowHours,
    ),
    new AwsTransitGatewayIdleScanner(
      pricing,
      accountId,
      new TransitGatewayIdleAttachmentPolicy(policyOptions),
      cloudwatchWindowHours,
    ),
    new AwsKinesisIdleScanner(
      pricing,
      accountId,
      new KinesisProvisionedIdleStreamPolicy(policyOptions),
      cloudwatchWindowHours,
    ),
  ];

  // Gated on --live-pricing: the price per instance type/RDS class/ElastiCache
  // node type isn't in the static price list (cardinality too high),
  // so without live prices there's no estimable saving and the scanners
  // remain disabled (EC2/RDS are advisory; ElastiCache is definite waste
  // once the price is known, but it's still gated on the same resource).
  if (livePricingAdapter) {
    scanners.push(
      new AwsEc2UnderutilizedScanner(
        livePricingAdapter,
        accountId,
        new Ec2UnderutilizedPolicy(policyOptions, ctx.config.thresholds?.ec2CpuPercent ?? 5),
        utilizationWindowHours,
      ),
      new AwsRdsUnderutilizedScanner(
        livePricingAdapter,
        accountId,
        new RdsUnderutilizedPolicy(policyOptions, ctx.config.thresholds?.rdsCpuPercent ?? 5),
        utilizationWindowHours,
      ),
      new AwsElastiCacheIdleScanner(
        livePricingAdapter,
        accountId,
        new ElastiCacheIdlePolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      // Phase 5.5 (ADR-0038): per-instance/node/broker-type pricing, same
      // reasoning as EC2/RDS/ElastiCache above (ADR-0037).
      new AwsRedshiftIdleScanner(
        livePricingAdapter,
        accountId,
        new RedshiftIdleClusterPolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      new AwsOpenSearchIdleScanner(
        livePricingAdapter,
        accountId,
        new OpenSearchIdleDomainPolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      new AwsMskIdleScanner(
        livePricingAdapter,
        accountId,
        new MskIdleClusterPolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      new AwsDocumentDbIdleScanner(
        livePricingAdapter,
        accountId,
        new DocumentDbIdleInstancePolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      new AwsNeptuneIdleScanner(
        livePricingAdapter,
        accountId,
        new NeptuneIdleInstancePolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      new AwsMqIdleScanner(
        livePricingAdapter,
        accountId,
        new MqIdleBrokerPolicy(policyOptions),
        cloudwatchWindowHours,
      ),
      new AwsWorkspacesIdleScanner(livePricingAdapter, accountId, new WorkspacesIdlePolicy(policyOptions)),
    );
  }

  return scanners;
}

/** Real composition: layered pricing + AWS scanners (one advisory, gated on --live-pricing) + generic use case. */
async function defaultCreateAnalysis(ctx: AnalysisContext): Promise<Analysis> {
  const { pricing, livePricingAdapter } = await buildPricing(ctx);
  const scanners = buildScanners(ctx, pricing, livePricingAdapter);
  return { useCase: new AnalyzeCloudWasteUseCase(scanners), pricesAsOf: pricing.getPricesAsOf() };
}

export const defaultAnalyzeDeps: AnalyzeDeps = {
  loadConfig,
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};
