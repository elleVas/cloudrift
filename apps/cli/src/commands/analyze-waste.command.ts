// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { DEFAULT_IGNORE_TAG } from 'cloud-cost-domain';
import type { ResourceKind, WastePolicyOptions } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { formatWasteReportAsMarkdown } from '../formatters/waste-report.markdown-formatter';
import { renderBanner } from '../ascii-banner';
import {
  promptScannerSelection,
  shouldPromptScannerSelection,
} from '../wizard/scanner-selection.wizard';
import {
  defaultAnalyzeDeps,
  type AnalyzeDeps,
} from './analyze-waste.composition';
import { resolveMinAgeDays, resolveExplicitScanners, resolveRegions } from './resolve-options';
import { writeArtifacts, applyCostGate } from './post-analysis';

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
  // accountId is only ever 'unknown' when both --account-id was omitted and
  // STS GetCallerIdentity failed (e.g. credentials lack that permission) —
  // surfaced here so the omission in the report isn't silent, with the
  // override the user needs right in the message.
  if (accountId === 'unknown') {
    info(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

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

  const { useCase, pricesAsOf, dispose } = await deps.createAnalysis({
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
  dispose?.();
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
