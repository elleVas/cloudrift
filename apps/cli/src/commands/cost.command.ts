// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { CompareCostUseCase } from 'cost-analytics-application';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import { formatCostComparisonAsTable } from '../formatters/cost-comparison.table-formatter';
import { formatCostComparisonAsJson } from '../formatters/cost-comparison.json-formatter';
import { formatCostComparisonAsCsv } from '../formatters/cost-comparison.csv-formatter';
import { generateCostComparisonPdf } from '../formatters/cost-comparison.pdf-formatter';
import { confirmCostExplorerCharge } from '../wizard/cost-confirmation.wizard';
import { startScanSpinner } from '../wizard/scan-spinner';
import { defaultCostAnalyticsDeps, type CostAnalyticsDeps } from './cost-analytics.composition';
import { applyCostTrendGate } from './post-analysis';
import { reportCliError as fail } from './report-cli-error';
import { OUTPUT_FORMATS, isOutputFormat } from '../output-format';
import { resolveCredentials } from './resolve-options';

export interface CostCommandOptions {
  accountId?: string;
  assumeRoleArn?: string;
  externalId?: string;
  config?: string;
  format?: string;
  failOnIncrease?: string;
  refreshCache?: boolean;
  silent?: boolean;
  yes?: boolean;
  pdf?: string | boolean;
  csv?: string | boolean;
}

/**
 * `cost`: current-vs-previous spend comparison using identical day-of-month
 * windows on both sides (see `CompareCostUseCase`), broken down by service.
 */
export async function costCommand(
  options: CostCommandOptions,
  deps: CostAnalyticsDeps = defaultCostAnalyticsDeps,
): Promise<void> {
  const format = options.format ?? 'table';
  if (!isOutputFormat(OUTPUT_FORMATS, format)) {
    return fail(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Got "${options.format}".`);
  }

  let failOnIncrease: number | undefined;
  if (options.failOnIncrease !== undefined) {
    const parsed = Number(options.failOnIncrease);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fail(`--fail-on-increase must be a non-negative number. Got "${options.failOnIncrease}".`);
    }
    failOnIncrease = parsed;
  }

  const configResult = await deps.loadConfig(process.cwd(), options.config);
  if (!configResult.ok) return fail(configResult.error.message);
  const config = configResult.value;

  // Same stdout-routing convention as `analyze`: machine-readable formats
  // and --silent keep chrome off stdout so the report stays pipeline-composable.
  const silent = options.silent === true;
  const quietStdout = format !== 'table' || silent;
  const info = silent
    ? () => undefined
    : quietStdout
      ? (msg: string) => console.error(msg)
      : (msg: string) => console.log(msg);

  const proceed = await confirmCostExplorerCharge({ yes: options.yes === true, silent });
  if (!proceed) return;

  const credentialsResult = await resolveCredentials(options);
  if (!credentialsResult.ok) return fail(credentialsResult.error.message);
  const credentials = credentialsResult.value;

  const accountId = options.accountId ?? (await deps.resolveAccountId(credentials)) ?? 'unknown';
  if (accountId === 'unknown') {
    info(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

  const costExplorer = deps.createCostExplorer(accountId, options.refreshCache === true, credentials);
  const spinner = quietStdout ? undefined : await startScanSpinner('  Fetching from Cost Explorer...');
  const result = await new CompareCostUseCase(costExplorer).execute({});
  spinner?.stop(chalk.dim('  Done.'));
  if (!result.ok) return fail(result.error.message);

  const meta: CostAnalyticsMeta = { accountId, generatedAt: new Date() };

  if (!silent) {
    let rendered: string;
    if (format === 'json') {
      rendered = formatCostComparisonAsJson(result.value, meta);
    } else if (format === 'csv') {
      rendered = formatCostComparisonAsCsv(result.value, meta);
    } else {
      rendered = formatCostComparisonAsTable(result.value);
    }
    console.log(rendered);
  }

  const day = meta.generatedAt.toISOString().split('T')[0].replaceAll('-', '_');

  if (options.csv !== undefined && options.csv !== false) {
    const csvPath =
      typeof options.csv === 'string'
        ? resolve(process.cwd(), options.csv)
        : resolve(process.cwd(), 'reports', `cloudrift-cost-${day}.csv`);
    await mkdir(dirname(csvPath), { recursive: true });
    await writeFile(csvPath, formatCostComparisonAsCsv(result.value, meta));
    info(chalk.green(`  CSV report saved to ${csvPath}`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const outputPath =
      typeof options.pdf === 'string'
        ? resolve(process.cwd(), options.pdf)
        : resolve(process.cwd(), 'reports', `cloudrift-cost-${day}.pdf`);
    await mkdir(dirname(outputPath), { recursive: true });
    await generateCostComparisonPdf(result.value, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }

  applyCostTrendGate(result.value, failOnIncrease ?? config.costIncreaseAlertPercent);
}
