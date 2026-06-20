import chalk from 'chalk';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';
import type { Result } from 'shared-kernel';
import {
  AwsRegion,
  DEFAULT_IGNORE_TAG,
  DEFAULT_MIN_AGE_DAYS,
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
  FindWastedResourcesUseCasePort,
  PricingPort,
  WastePolicyOptions,
  WasteScannerPort,
} from 'cloud-cost-domain';
import { AnalyzeCloudWasteUseCase } from 'cloud-cost-application';
import type { WasteReportMeta } from 'cloud-cost-application';
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
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { formatWasteReportAsMarkdown } from '../formatters/waste-report.markdown-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';

const DEFAULT_CLOUDWATCH_WINDOW_HOURS = 48;
const DEFAULT_UTILIZATION_WINDOW_HOURS = 168;
const OUTPUT_FORMATS = ['table', 'json', 'markdown'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface AnalyzeWasteOptions {
  regions: string[];
  accountId?: string;
  config?: string;
  format?: string;
  livePricing?: boolean;
  pdf?: string | boolean;
  json?: string | boolean;
  minAgeDays?: string;
  ignoreTag?: string;
}

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

/** Composizione reale: pricing a livelli + scanner AWS (uno advisory gated su --live-pricing) + use case generico. */
async function defaultCreateAnalysis(ctx: AnalysisContext): Promise<Analysis> {
  // Pricing a livelli: listino statico (base) ← AWS Pricing API live (--live-pricing)
  // ← override utente (config.prices, vincono).
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

  return { useCase: new AnalyzeCloudWasteUseCase(scanners), pricesAsOf: pricing.getPricesAsOf() };
}

export const defaultAnalyzeDeps: AnalyzeDeps = {
  loadConfig,
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};

function fail(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}

/**
 * Composition root del comando `analyze`. Risolve opzioni e config, delega a
 * `deps.createAnalysis` la costruzione di pricing + scanner (l'unico punto che
 * tocca AWS), poi renderizza, scrive gli artefatti e applica il gate di soglia.
 *
 * Precedenza dei parametri: flag CLI > file di config > default nel codice.
 */
export async function analyzeWasteCommand(
  options: AnalyzeWasteOptions,
  deps: AnalyzeDeps = defaultAnalyzeDeps,
): Promise<void> {
  const format = (options.format ?? 'table') as OutputFormat;
  if (!OUTPUT_FORMATS.includes(format)) {
    return fail(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Got "${options.format}".`);
  }
  // In modalità machine-readable lo stdout deve contenere SOLO il report:
  // il chrome umano (banner, conferme) viene instradato su stderr.
  const quietStdout = format !== 'table';
  const info = quietStdout
    ? (msg: string) => console.error(msg)
    : (msg: string) => console.log(msg);

  const configResult = await deps.loadConfig(process.cwd(), options.config);
  if (!configResult.ok) return fail(configResult.error.message);
  const config = configResult.value;

  // Periodo di grazia: CLI > config > default.
  let minAgeDays: number;
  if (options.minAgeDays !== undefined) {
    minAgeDays = Number(options.minAgeDays);
    if (!Number.isInteger(minAgeDays) || minAgeDays < 0) {
      return fail(`--min-age-days must be a non-negative integer, got "${options.minAgeDays}".`);
    }
  } else {
    minAgeDays = config.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
  }

  const ignoreTag = options.ignoreTag ?? config.ignoreTag ?? DEFAULT_IGNORE_TAG;
  const cloudwatchWindowHours =
    config.cloudwatchWindowHours ?? DEFAULT_CLOUDWATCH_WINDOW_HOURS;
  const utilizationWindowHours =
    config.utilizationWindowHours ?? DEFAULT_UTILIZATION_WINDOW_HOURS;

  // Regioni: parse Result-based (niente throw su input), poi esclusione da config.
  const excluded = new Set(config.excludeRegions ?? []);
  const regions: AwsRegion[] = [];
  const skipped: string[] = [];
  for (const code of options.regions) {
    const parsed = AwsRegion.parse(code);
    if (!parsed.ok) return fail(parsed.error.message);
    if (excluded.has(parsed.value.code)) {
      skipped.push(parsed.value.code);
      continue;
    }
    regions.push(parsed.value);
  }

  if (regions.length === 0) {
    return fail(
      'No regions left to scan: all requested regions are listed in excludeRegions.',
    );
  }

  const accountId = options.accountId ?? (await deps.resolveAccountId()) ?? 'unknown';

  if (!quietStdout) {
    const accountLabel = accountId !== 'unknown' ? ` (account ${accountId})` : '';
    console.log(
      chalk.bold.blue(
        `\n  Scanning ${regions.map((r) => r.code).join(', ')}${accountLabel} for wasted cloud resources...\n`,
      ),
    );
  }
  if (skipped.length > 0) {
    info(chalk.dim(`  Skipping excluded regions: ${skipped.join(', ')}`));
  }

  const policyOptions: WastePolicyOptions = {
    minAgeDays,
    ignoreTag,
    excludeTagValues: config.excludeTagValues,
  };

  const { useCase, pricesAsOf } = await deps.createAnalysis({
    regions,
    config,
    accountId,
    livePricing: options.livePricing === true,
    policyOptions,
    cloudwatchWindowHours,
    utilizationWindowHours,
    info,
  });

  const result = await useCase.execute({ regions });
  if (!result.ok) return fail(result.error.message);

  const meta: WasteReportMeta = {
    accountId,
    regions: regions.map((r) => r.code),
    generatedAt: new Date(),
    pricesAsOf,
  };

  // Il report scelto va SEMPRE su stdout (così è componibile in pipeline:
  // `--format json | jq`, `--format markdown >> $GITHUB_STEP_SUMMARY`).
  let rendered: string;
  if (format === 'json') {
    rendered = formatWasteReportAsJson(result.value, meta);
  } else if (format === 'markdown') {
    rendered = formatWasteReportAsMarkdown(result.value, meta, {
      costAlertThresholdUsd: config.costAlertThresholdUsd,
    });
  } else {
    rendered = formatWasteReportAsTable(result.value, meta);
  }
  console.log(rendered);

  const day = meta.generatedAt.toISOString().split('T')[0];

  // --json / --pdf sono artefatti su file, indipendenti dal formato di stdout.
  if (options.json !== undefined && options.json !== false) {
    const filename =
      typeof options.json === 'string' ? options.json : `cloudrift-report-${day}.json`;
    const jsonPath = resolve(process.cwd(), filename);
    await writeFile(jsonPath, formatWasteReportAsJson(result.value, meta));
    info(chalk.green(`  JSON report saved to ${jsonPath}`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const filename =
      typeof options.pdf === 'string' ? options.pdf : `cloudrift-report-${day}.pdf`;
    const outputPath = resolve(process.cwd(), filename);

    info(chalk.bold('  Generating PDF report...'));
    await generateWasteReportPdf(result.value, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }

  // Soglia di costo per le pipeline: exit code 2 quando il totale WASTE la supera
  // (le opportunità di ottimizzazione, stimate, non concorrono al gate).
  // Il messaggio va su stderr per non sporcare l'output machine-readable su stdout.
  if (
    config.costAlertThresholdUsd !== undefined &&
    result.value.totalWasteMonthlyUsd > config.costAlertThresholdUsd
  ) {
    console.error(
      chalk.red.bold(
        `\n  Waste threshold exceeded: $${result.value.totalWasteMonthlyUsd.toFixed(2)}/mo ` +
          `> $${config.costAlertThresholdUsd.toFixed(2)}/mo threshold.\n`,
      ),
    );
    process.exitCode = 2;
  }
}
