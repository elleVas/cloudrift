// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import type { CloudCostComparison, HistoryComparison, HygieneComparison } from '../commands/history-comparison';

function formatUsd(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function deltaColorFor(deltaUsd: number): (text: string) => string {
  if (deltaUsd > 0) return chalk.red;
  if (deltaUsd < 0) return chalk.green;
  return chalk.dim;
}

function sumSeverities(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

export function formatHistoryComparisonAsTable(comparison: HistoryComparison): string {
  const olderDate = comparison.olderGeneratedAt.split('T')[0];
  const newerDate = comparison.newerGeneratedAt.split('T')[0];

  const lines: string[] = [chalk.bold(`\n  Comparing ${olderDate} → ${newerDate}\n`)];
  lines.push(...(comparison.domain === 'cloud-cost' ? formatCloudCostSection(comparison) : formatHygieneSection(comparison)));

  if (comparison.regionsChanged) {
    lines.push(chalk.yellow('\n  ⚠ The two runs scanned different regions — this comparison may not be apples-to-apples.'));
  }

  return lines.join('\n') + '\n';
}

function formatCloudCostSection(comparison: CloudCostComparison): string[] {
  const lines: string[] = [];
  const percent = comparison.deltaPercent === null ? '' : ` (${formatPercent(comparison.deltaPercent)})`;
  const delta = deltaColorFor(comparison.deltaUsd)(formatUsd(comparison.deltaUsd) + percent);
  lines.push(`  Monthly waste: $${comparison.olderTotalWasteMonthlyUsd.toFixed(2)} → $${comparison.newerTotalWasteMonthlyUsd.toFixed(2)}  ${delta}`);

  if (comparison.resolvedFindings.length > 0) {
    lines.push(chalk.green(`\n  Presumed resolved: $${comparison.presumedResolvedMonthlyUsd.toFixed(2)}/mo across ${comparison.resolvedFindings.length} finding(s) no longer present`));
    for (const f of comparison.resolvedFindings) {
      lines.push(`    - ${f.kind} ${f.id} ($${f.monthlyCostUsd.toFixed(2)}/mo)`);
    }
  } else {
    lines.push(chalk.dim('\n  No findings resolved since the older run.'));
  }

  if (comparison.newFindings.length > 0) {
    lines.push(chalk.yellow(`\n  New waste since then: ${comparison.newFindings.length} finding(s)`));
    for (const f of comparison.newFindings) {
      lines.push(`    - ${f.kind} ${f.id} ($${f.monthlyCostUsd.toFixed(2)}/mo)`);
    }
  }

  return lines;
}

function formatHygieneSection(comparison: HygieneComparison): string[] {
  const older = comparison.olderCountBySeverity;
  const newer = comparison.newerCountBySeverity;
  const lines: string[] = [
    `  Findings: ${sumSeverities(older)} → ${sumSeverities(newer)}` +
      `  (critical ${older.critical ?? 0}→${newer.critical ?? 0},` +
      ` warning ${older.warning ?? 0}→${newer.warning ?? 0},` +
      ` info ${older.info ?? 0}→${newer.info ?? 0})`,
  ];

  if (comparison.resolvedFindings.length > 0) {
    lines.push(chalk.green(`\n  Resolved: ${comparison.resolvedFindings.length} finding(s) no longer present`));
    for (const f of comparison.resolvedFindings) {
      lines.push(`    - ${f.kind} ${f.id} (${f.severity})`);
    }
  } else {
    lines.push(chalk.dim('\n  No findings resolved since the older run.'));
  }

  if (comparison.newFindings.length > 0) {
    lines.push(chalk.yellow(`\n  New: ${comparison.newFindings.length} finding(s)`));
    for (const f of comparison.newFindings) {
      lines.push(`    - ${f.kind} ${f.id} (${f.severity})`);
    }
  }

  return lines;
}
