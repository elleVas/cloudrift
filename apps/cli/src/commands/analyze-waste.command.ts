import chalk from 'chalk';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';
import { Result } from 'shared-kernel';
import { AwsRegion, DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from 'cloud-cost-domain';
import type { WastedResourcesSummary, WastePolicyOptions } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { CloudriftConfig } from '../config/cloudrift.config';
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { formatWasteReportAsMarkdown } from '../formatters/waste-report.markdown-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';
import { defaultAnalyzeDeps, type AnalyzeDeps } from './analyze-waste.composition';

export type { AnalyzeDeps };

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

function fail(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}

/** Periodo di grazia: CLI > config > default. */
function resolveMinAgeDays(
  options: AnalyzeWasteOptions,
  config: CloudriftConfig,
): Result<number, Error> {
  if (options.minAgeDays === undefined) {
    return Result.ok(config.minAgeDays ?? DEFAULT_MIN_AGE_DAYS);
  }
  const minAgeDays = Number(options.minAgeDays);
  if (!Number.isInteger(minAgeDays) || minAgeDays < 0) {
    return Result.fail(
      new Error(`--min-age-days must be a non-negative integer, got "${options.minAgeDays}".`),
    );
  }
  return Result.ok(minAgeDays);
}

/** Regioni richieste: parse Result-based (niente throw su input), poi esclusione da config. */
function resolveRegions(
  options: AnalyzeWasteOptions,
  config: CloudriftConfig,
): Result<{ regions: AwsRegion[]; skipped: string[] }, Error> {
  const excluded = new Set(config.excludeRegions ?? []);
  const regions: AwsRegion[] = [];
  const skipped: string[] = [];
  for (const code of options.regions) {
    const parsed = AwsRegion.parse(code);
    if (!parsed.ok) return Result.fail(parsed.error);
    if (excluded.has(parsed.value.code)) {
      skipped.push(parsed.value.code);
      continue;
    }
    regions.push(parsed.value);
  }

  if (regions.length === 0) {
    return Result.fail(
      new Error('No regions left to scan: all requested regions are listed in excludeRegions.'),
    );
  }

  return Result.ok({ regions, skipped });
}

/** --json / --pdf sono artefatti su file, indipendenti dal formato di stdout. */
async function writeArtifacts(
  result: WastedResourcesSummary,
  meta: WasteReportMeta,
  options: AnalyzeWasteOptions,
  info: (msg: string) => void,
): Promise<void> {
  const day = meta.generatedAt.toISOString().split('T')[0];

  if (options.json !== undefined && options.json !== false) {
    const filename =
      typeof options.json === 'string' ? options.json : `cloudrift-report-${day}.json`;
    const jsonPath = resolve(process.cwd(), filename);
    await writeFile(jsonPath, formatWasteReportAsJson(result, meta));
    info(chalk.green(`  JSON report saved to ${jsonPath}`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const filename =
      typeof options.pdf === 'string' ? options.pdf : `cloudrift-report-${day}.pdf`;
    const outputPath = resolve(process.cwd(), filename);

    info(chalk.bold('  Generating PDF report...'));
    await generateWasteReportPdf(result, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }
}

/**
 * Soglia di costo per le pipeline: exit code 2 quando il totale WASTE la supera
 * (le opportunità di ottimizzazione, stimate, non concorrono al gate).
 * Il messaggio va su stderr per non sporcare l'output machine-readable su stdout.
 */
function applyCostGate(summary: WastedResourcesSummary, config: CloudriftConfig): void {
  if (
    config.costAlertThresholdUsd === undefined ||
    summary.totalWasteMonthlyUsd <= config.costAlertThresholdUsd
  ) {
    return;
  }
  console.error(
    chalk.red.bold(
      `\n  Waste threshold exceeded: $${summary.totalWasteMonthlyUsd.toFixed(2)}/mo ` +
        `> $${config.costAlertThresholdUsd.toFixed(2)}/mo threshold.\n`,
    ),
  );
  process.exitCode = 2;
}

/**
 * Composition root del comando `analyze`. Risolve opzioni e config, delega a
 * `deps.createAnalysis` la costruzione di pricing + scanner (l'unico punto che
 * tocca AWS, definito in `analyze-waste.composition.ts`), poi renderizza, scrive
 * gli artefatti e applica il gate di soglia.
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

  const minAgeDaysResult = resolveMinAgeDays(options, config);
  if (!minAgeDaysResult.ok) return fail(minAgeDaysResult.error.message);
  const minAgeDays = minAgeDaysResult.value;

  const ignoreTag = options.ignoreTag ?? config.ignoreTag ?? DEFAULT_IGNORE_TAG;
  const cloudwatchWindowHours =
    config.cloudwatchWindowHours ?? DEFAULT_CLOUDWATCH_WINDOW_HOURS;
  const utilizationWindowHours =
    config.utilizationWindowHours ?? DEFAULT_UTILIZATION_WINDOW_HOURS;

  const regionsResult = resolveRegions(options, config);
  if (!regionsResult.ok) return fail(regionsResult.error.message);
  const { regions, skipped } = regionsResult.value;

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

  await writeArtifacts(result.value, meta, options, info);
  applyCostGate(result.value, config);
}
