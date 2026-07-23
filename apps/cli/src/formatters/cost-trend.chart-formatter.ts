// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import type { CostTrendSummary } from 'cost-analytics-domain';

const BAR_WIDTH = 40;
const BAR_CHAR = '█';

export function formatCostTrendAsChart(summary: CostTrendSummary): string {
  const lines: string[] = [];
  const scope = summary.filteredServices?.length
    ? summary.filteredServices.join(', ')
    : 'all services';
  lines.push(chalk.bold.blue(`\n  Monthly spend trend — ${scope}\n`));

  if (summary.months.length === 0) {
    lines.push(chalk.dim('  No data.'));
    return lines.join('\n');
  }

  const maxUsd = Math.max(...summary.months.map((m) => m.totalUsd), 0.01);
  const monthLabelWidth = Math.max(...summary.months.map((m) => m.month.length));

  for (const month of summary.months) {
    const barLen = Math.round((month.totalUsd / maxUsd) * BAR_WIDTH);
    const bar = BAR_CHAR.repeat(Math.max(barLen, month.totalUsd > 0 ? 1 : 0)).padEnd(BAR_WIDTH);
    const coloredBar = month.final ? chalk.cyan(bar) : chalk.dim.cyan(bar);
    const amount = `$${month.totalUsd.toFixed(2)}${month.final ? '' : chalk.dim(' (estimated)')}`;
    lines.push(`  ${month.month.padEnd(monthLabelWidth)}  ${coloredBar} ${amount}`);
  }

  return lines.join('\n');
}
