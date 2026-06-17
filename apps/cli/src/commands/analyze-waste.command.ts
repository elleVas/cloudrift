import chalk from 'chalk';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';
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
} from 'cloud-cost-domain';
import type { WastePolicyOptions, WasteScannerPort } from 'cloud-cost-domain';
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
  StaticPriceTableAdapter,
  TablePricingAdapter,
  AwsPricingApiAdapter,
  BUILTIN_PRICE_TABLE,
  BUILTIN_PRICES_AS_OF,
  mergePriceTables,
  resolveAwsAccountId,
} from 'cloud-cost-infrastructure-aws-adapter';
import type { PriceTable } from 'cloud-cost-infrastructure-aws-adapter';
import type { PricingPort } from 'cloud-cost-domain';
import { loadConfig } from '../config/cloudrift.config';
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { formatWasteReportAsMarkdown } from '../formatters/waste-report.markdown-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';

const DEFAULT_CLOUDWATCH_WINDOW_HOURS = 48;
const OUTPUT_FORMATS = ['table', 'json', 'markdown'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

interface AnalyzeWasteOptions {
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

function fail(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}

/**
 * Composition root: l'unico punto dove le implementazioni concrete (scanner
 * AWS, listino prezzi) vengono istanziate e iniettate nel use case.
 *
 * Precedenza dei parametri: flag CLI > file di config > default nel codice.
 */
export async function analyzeWasteCommand(
  options: AnalyzeWasteOptions,
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

  const configResult = await loadConfig(process.cwd(), options.config);
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

  const accountId = options.accountId ?? (await resolveAwsAccountId()) ?? 'unknown';

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

  // Pricing a livelli: listino statico (base) ← AWS Pricing API live (--live-pricing)
  // ← override utente (config.prices, vincono). Gli override per regione servono
  // per tariffe negoziate/aziendali, così il report riflette la bolletta reale.
  let priceTable: PriceTable = BUILTIN_PRICE_TABLE;
  let pricesAsOf = BUILTIN_PRICES_AS_OF;
  let layered = false;

  if (options.livePricing) {
    info(chalk.dim('  Fetching current prices from the AWS Pricing API...'));
    const live = await new AwsPricingApiAdapter().warmUp(regions);
    if (live.ok) {
      priceTable = mergePriceTables(priceTable, live.value);
      pricesAsOf = new Date().toISOString().slice(0, 7); // YYYY-MM
      layered = true;
    } else {
      info(
        chalk.yellow(
          `  Live pricing unavailable (${live.error.message}); using the static price table.`,
        ),
      );
    }
  }

  if (config.prices) {
    priceTable = mergePriceTables(priceTable, config.prices);
    pricesAsOf = `${pricesAsOf} + custom overrides`;
    layered = true;
  }

  const pricing: PricingPort = layered
    ? new TablePricingAdapter(priceTable, pricesAsOf)
    : new StaticPriceTableAdapter();

  const policyOptions: WastePolicyOptions = {
    minAgeDays,
    ignoreTag,
    excludeTagValues: config.excludeTagValues,
  };

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
  ];

  const useCase = new AnalyzeCloudWasteUseCase(scanners);
  const result = await useCase.execute({ regions });

  if (!result.ok) return fail(result.error.message);

  const meta: WasteReportMeta = {
    accountId,
    regions: regions.map((r) => r.code),
    generatedAt: new Date(),
    pricesAsOf: pricing.getPricesAsOf(),
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

  // Soglia di costo per le pipeline: exit code 2 quando il totale la supera.
  // Il messaggio va su stderr per non sporcare l'output machine-readable su stdout.
  if (
    config.costAlertThresholdUsd !== undefined &&
    result.value.totalMonthlyCostUsd > config.costAlertThresholdUsd
  ) {
    console.error(
      chalk.red.bold(
        `\n  Cost threshold exceeded: $${result.value.totalMonthlyCostUsd.toFixed(2)}/mo ` +
          `> $${config.costAlertThresholdUsd.toFixed(2)}/mo threshold.\n`,
      ),
    );
    process.exitCode = 2;
  }
}
