// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir } from 'fs/promises';
import { CompareCostUseCase } from 'cost-analytics-application';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import { formatCostComparisonAsTable } from '../formatters/cost-comparison.table-formatter';
import { formatCostComparisonAsJson } from '../formatters/cost-comparison.json-formatter';
import { generateCostComparisonPdf } from '../formatters/cost-comparison.pdf-formatter';
import { confirmCostExplorerCharge } from '../wizard/cost-confirmation.wizard';
import { startScanSpinner } from '../wizard/scan-spinner';
import { defaultCostAnalyticsDeps, type CostAnalyticsDeps } from './cost-analytics.composition';
import { applyCostTrendGate } from './post-analysis';

const OUTPUT_FORMATS = ['table', 'json'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface CostCommandOptions {
  accountId?: string;
  config?: string;
  format?: string;
  failOnIncrease?: string;
  refreshCache?: boolean;
  silent?: boolean;
  yes?: boolean;
  pdf?: string | boolean;
}

function fail(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}

/**
 * `cost`: current-vs-previous spend comparison using identical day-of-month
 * windows on both sides (see `CompareCostUseCase`), broken down by service.
 */
export async function costCommand(
  options: CostCommandOptions,
  deps: CostAnalyticsDeps = defaultCostAnalyticsDeps,
): Promise<void> {
  const format = (options.format ?? 'table') as OutputFormat;
  if (!OUTPUT_FORMATS.includes(format)) {
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

  const accountId = options.accountId ?? (await deps.resolveAccountId()) ?? 'unknown';
  if (accountId === 'unknown') {
    info(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

  const costExplorer = deps.createCostExplorer(accountId, options.refreshCache === true);
  const spinner = quietStdout ? undefined : await startScanSpinner('  Fetching from Cost Explorer...');
  const result = await new CompareCostUseCase(costExplorer).execute({});
  spinner?.stop(chalk.dim('  Done.'));
  if (!result.ok) return fail(result.error.message);

  const meta: CostAnalyticsMeta = { accountId, generatedAt: new Date() };

  if (!silent) {
    const rendered =
      format === 'json'
        ? formatCostComparisonAsJson(result.value, meta)
        : formatCostComparisonAsTable(result.value);
    console.log(rendered);
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const day = meta.generatedAt.toISOString().split('T')[0].replaceAll('-', '_');
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
