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

/** Contesto risolto passato a `createAnalysis` per costruire pricing + scanner. */
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
 * Seam di injection: tutto ciò che tocca AWS passa da qui. Il default compone
 * gli scanner reali; i test CLI iniettano fake per verificare formato, exit
 * code e routing dello stdout senza credenziali AWS.
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
 * Pricing a livelli: listino statico (base) ← AWS Pricing API live (--live-pricing)
 * ← override utente (config.prices, vincono).
 */
async function buildPricing(ctx: AnalysisContext): Promise<BuiltPricing> {
  let priceTable: PriceTable = BUILTIN_PRICE_TABLE;
  let pricesAsOf = BUILTIN_PRICES_AS_OF;
  let layered = false;
  // L'EC2 underutilized scanner risolve il prezzo per-instance-type on-demand
  // dalla stessa istanza di AwsPricingApiAdapter: senza --live-pricing non c'è
  // un prezzo per instance type, quindi lo scanner non viene registrato.
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

/** Scanner sempre attivi + scanner advisory gated su --live-pricing. */
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
  ];

  // Advisory, gated su --live-pricing: il prezzo per instance type/classe RDS
  // non rientra nel listino statico (cardinalità troppo alta), quindi senza
  // prezzi live non c'è risparmio stimabile e gli scanner restano disattivati.
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
    );
  }

  return scanners;
}

/** Composizione reale: pricing a livelli + scanner AWS (uno advisory gated su --live-pricing) + use case generico. */
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
