// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { Result } from 'shared-kernel';
import {
  AwsRegion,
  DEFAULT_IGNORE_TAG,
  DEFAULT_MIN_AGE_DAYS,
  RESOURCE_KINDS,
} from 'cloud-cost-domain';
import type {
  ResourceKind,
  WastedResourcesSummary,
  WastePolicyOptions,
} from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { CloudriftConfig } from '../config/cloudrift.config';
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { formatWasteReportAsMarkdown } from '../formatters/waste-report.markdown-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';
import { renderBanner, delay } from '../ascii-banner';
import {
  promptScannerSelection,
  shouldPromptScannerSelection,
} from '../wizard/scanner-selection.wizard';
import {
  defaultAnalyzeDeps,
  type AnalyzeDeps,
} from './analyze-waste.composition';

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
  silent?: boolean;
  scanners?: string[];
  allServices?: boolean;
}

function fail(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}

/** Grace period: CLI > config > default. */
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
      new Error(
        `--min-age-days must be a non-negative integer, got "${options.minAgeDays}".`,
      ),
    );
  }
  return Result.ok(minAgeDays);
}

/** --scanners: Result-based validation against the known RESOURCE_KINDS (no throw on bad input). */
function resolveExplicitScanners(scanners: string[]): Result<ResourceKind[], Error> {
  const valid = new Set<string>(RESOURCE_KINDS);
  const unknown = scanners.filter((kind) => !valid.has(kind));
  if (unknown.length > 0) {
    return Result.fail(
      new Error(
        `--scanners: unknown service(s) "${unknown.join(', ')}". Valid values: ${RESOURCE_KINDS.join(', ')}.`,
      ),
    );
  }
  return Result.ok(scanners as ResourceKind[]);
}

/** Requested regions: Result-based parse (no throw on input), then exclusion from config. */
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
      new Error(
        'No regions left to scan: all requested regions are listed in excludeRegions.',
      ),
    );
  }

  return Result.ok({ regions, skipped });
}

/** --json / --pdf are file artifacts, independent of the stdout format. */
async function writeArtifacts(
  result: WastedResourcesSummary,
  meta: WasteReportMeta,
  options: AnalyzeWasteOptions,
  info: (msg: string) => void,
): Promise<void> {
  const day = meta.generatedAt.toISOString().split('T')[0].replaceAll('-', '_');

  if (options.json !== undefined && options.json !== false) {
    const jsonPath =
      typeof options.json === 'string'
        ? resolve(process.cwd(), options.json)
        : resolve(process.cwd(), 'reports', `AWS_report_${day}.json`);
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, formatWasteReportAsJson(result, meta));
    info(chalk.green(`  JSON report saved to ${jsonPath}`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const outputPath =
      typeof options.pdf === 'string'
        ? resolve(process.cwd(), options.pdf)
        : resolve(process.cwd(), 'reports', `AWS_report_${day}.pdf`);
    await mkdir(dirname(outputPath), { recursive: true });

    info(chalk.bold('  Generating PDF report...'));
    await generateWasteReportPdf(result, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }
}

/**
 * Cost threshold for pipelines: exit code 2 when the total WASTE exceeds it
 * (optimization opportunities, being estimates, do not count toward the gate).
 * The message goes to stderr so it doesn't pollute the machine-readable output on stdout.
 */
function applyCostGate(
  summary: WastedResourcesSummary,
  config: CloudriftConfig,
): void {
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
 * Composition root for the `analyze` command. Resolves options and config, delegates to
 * `deps.createAnalysis` the construction of pricing + scanners (the only point that
 * touches AWS, defined in `analyze-waste.composition.ts`), then renders, writes
 * the artifacts, and applies the threshold gate.
 *
 * Parameter precedence: CLI flags > config file > defaults in code.
 */
export async function analyzeWasteCommand(
  options: AnalyzeWasteOptions,
  deps: AnalyzeDeps = defaultAnalyzeDeps,
  bannerDelayMs = 3000,
): Promise<void> {
  const format = (options.format ?? 'table') as OutputFormat;
  if (!OUTPUT_FORMATS.includes(format)) {
    return fail(
      `--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Got "${options.format}".`,
    );
  }

  // Which scanners to run: --all-services / --scanners are explicit and skip
  // the wizard below entirely; otherwise the wizard decides interactively, or
  // (CI / piped stdout) every scanner runs — the same default as before this
  // option existed.
  let scannerKinds: ResourceKind[] | undefined;
  let explicitScannerSelection = false;
  if (options.allServices) {
    explicitScannerSelection = true;
  } else if (options.scanners && options.scanners.length > 0) {
    const scannersResult = resolveExplicitScanners(options.scanners);
    if (!scannersResult.ok) return fail(scannersResult.error.message);
    scannerKinds = scannersResult.value;
    explicitScannerSelection = true;
  }

  // In machine-readable mode stdout must contain ONLY the report:
  // human chrome (banner, confirmations) is routed to stderr. --silent goes
  // further: no chrome and no report at all, just the file artifacts (if any) —
  // errors and the cost-gate alert still surface, same as every other mode.
  const silent = options.silent === true;
  const quietStdout = format !== 'table' || silent;
  const info = silent
    ? () => undefined
    : quietStdout
      ? (msg: string) => console.error(msg)
      : (msg: string) => console.log(msg);

  if (!quietStdout) {
    console.log(`\n${renderBanner()}\n`);
    if (bannerDelayMs > 0) await delay(bannerDelayMs);
  }

  if (!explicitScannerSelection && !silent && shouldPromptScannerSelection()) {
    const selected = await promptScannerSelection();
    if (selected === undefined) return; // cancelled: exit cleanly, no scan run
    scannerKinds = selected;
  }

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

  const accountId =
    options.accountId ?? (await deps.resolveAccountId()) ?? 'unknown';

  if (!quietStdout) {
    const accountLabel =
      accountId !== 'unknown' ? ` (account ${accountId})` : '';
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
    scannerKinds,
  });

  const result = await useCase.execute({ regions });
  if (!result.ok) return fail(result.error.message);

  const meta: WasteReportMeta = {
    accountId,
    regions: regions.map((r) => r.code),
    generatedAt: new Date(),
    pricesAsOf,
  };

  // The chosen report ALWAYS goes to stdout (so it's pipeline-composable:
  // `--format json | jq`, `--format markdown >> $GITHUB_STEP_SUMMARY`) —
  // unless --silent asked for file artifacts only.
  if (!silent) {
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
  }

  await writeArtifacts(result.value, meta, options, info);
  applyCostGate(result.value, config);
}
