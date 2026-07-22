// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir } from 'fs/promises';
import { CostTrendUseCase } from 'cloud-cost-application';
import type { CostAnalyticsMeta } from 'cloud-cost-application';
import { formatCostTrendAsChart } from '../formatters/cost-trend.chart-formatter';
import { formatCostTrendAsJson } from '../formatters/cost-trend.json-formatter';
import { generateCostTrendPdf } from '../formatters/cost-trend.pdf-formatter';
import { resolveServiceNames } from '../config/cost-explorer-service-names';
import { confirmCostExplorerCharge } from '../wizard/cost-confirmation.wizard';
import { defaultCostAnalyticsDeps, type CostAnalyticsDeps } from './cost-analytics.composition';

const OUTPUT_FORMATS = ['table', 'json'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];
const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 36;

export interface TrendCommandOptions {
  accountId?: string;
  config?: string;
  format?: string;
  months?: string;
  services?: string[];
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
 * `trend`: monthly spend over the last N calendar months (default 6,
 * including the current partial one), optionally restricted to a set of
 * services. Rendered as an ANSI bar chart in the terminal by default.
 */
export async function trendCommand(
  options: TrendCommandOptions,
  deps: CostAnalyticsDeps = defaultCostAnalyticsDeps,
): Promise<void> {
  const format = (options.format ?? 'table') as OutputFormat;
  if (!OUTPUT_FORMATS.includes(format)) {
    return fail(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Got "${options.format}".`);
  }

  let months = DEFAULT_MONTHS;
  if (options.months !== undefined) {
    const parsed = Number.parseInt(options.months, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_MONTHS) {
      return fail(`--months must be an integer between 1 and ${MAX_MONTHS}. Got "${options.months}".`);
    }
    months = parsed;
  }

  const services = options.services ? resolveServiceNames(options.services) : undefined;

  const configResult = await deps.loadConfig(process.cwd(), options.config);
  if (!configResult.ok) return fail(configResult.error.message);

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
  const result = await new CostTrendUseCase(costExplorer).execute({ months, services });
  if (!result.ok) return fail(result.error.message);

  const meta: CostAnalyticsMeta = { accountId, generatedAt: new Date() };

  if (!silent) {
    const rendered =
      format === 'json' ? formatCostTrendAsJson(result.value, meta) : formatCostTrendAsChart(result.value);
    console.log(rendered);
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const day = meta.generatedAt.toISOString().split('T')[0].replaceAll('-', '_');
    const outputPath =
      typeof options.pdf === 'string'
        ? resolve(process.cwd(), options.pdf)
        : resolve(process.cwd(), 'reports', `cloudrift-trend-${day}.pdf`);
    await mkdir(dirname(outputPath), { recursive: true });
    await generateCostTrendPdf(result.value, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }
}
