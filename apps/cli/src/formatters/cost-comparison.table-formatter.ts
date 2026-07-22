// SPDX-License-Identifier: Apache-2.0
import Table from 'cli-table3';
import chalk from 'chalk';
import type { CostComparisonSummary } from 'cloud-cost-domain';

function formatChange(changeUsd: number, changePercent: number | null): string {
  const sign = changeUsd > 0 ? '+' : '';
  const pctLabel = changePercent === null ? 'n/a' : `${sign}${changePercent.toFixed(1)}%`;
  const text = `${sign}$${changeUsd.toFixed(2)} (${pctLabel})`;
  if (changeUsd > 0) return chalk.red(text);
  if (changeUsd < 0) return chalk.green(text);
  return chalk.dim(text);
}

export function formatCostComparisonAsTable(summary: CostComparisonSummary): string {
  const lines: string[] = [];
  lines.push(chalk.bold.blue('\n  Cost comparison — fair day-of-month window\n'));
  lines.push(
    `  Current period:  ${summary.current.start} → ${summary.current.end}  ` +
      chalk.bold(`$${summary.current.totalUsd.toFixed(2)}`),
  );
  lines.push(
    `  Previous period: ${summary.previous.start} → ${summary.previous.end}  $${summary.previous.totalUsd.toFixed(2)}`,
  );
  lines.push(`  Change: ${formatChange(summary.changeUsd, summary.changePercent)}`);

  if (summary.byService.length > 0) {
    lines.push(chalk.bold.yellow('\n  By service (biggest movers first)'));
    const table = new Table({
      head: ['Service', 'Current', 'Previous', 'Change'],
      style: { head: ['cyan'] },
    });
    for (const delta of summary.byService.slice(0, 20)) {
      table.push([
        delta.service,
        `$${delta.currentUsd.toFixed(2)}`,
        `$${delta.previousUsd.toFixed(2)}`,
        formatChange(delta.changeUsd, delta.changePercent),
      ]);
    }
    lines.push(table.toString());
  }

  return lines.join('\n');
}
