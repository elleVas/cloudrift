// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import type { CostComparisonSummary, WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { CloudriftConfig } from '../config/cloudrift.config';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';
import type { AnalyzeWasteOptions } from './analyze-waste.command';

/** --json / --pdf are file artifacts, independent of the stdout format. */
export async function writeArtifacts(
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
export function applyCostGate(
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
 * `cost` command threshold: exit code 2 when the current-vs-previous-period
 * spend increase exceeds `thresholdPercent` (CLI `--fail-on-increase`, or
 * config's `costIncreaseAlertPercent`). A `null` changePercent (previous
 * period was $0) never trips the gate — there's no meaningful percentage to
 * compare against a threshold.
 */
export function applyCostTrendGate(
  summary: CostComparisonSummary,
  thresholdPercent: number | undefined,
): void {
  if (
    thresholdPercent === undefined ||
    summary.changePercent === null ||
    summary.changePercent <= thresholdPercent
  ) {
    return;
  }
  console.error(
    chalk.red.bold(
      `\n  Spend increase threshold exceeded: +${summary.changePercent.toFixed(1)}% ` +
        `(current $${summary.current.totalUsd.toFixed(2)} vs previous $${summary.previous.totalUsd.toFixed(2)}) ` +
        `> ${thresholdPercent}% threshold.\n`,
    ),
  );
  process.exitCode = 2;
}
