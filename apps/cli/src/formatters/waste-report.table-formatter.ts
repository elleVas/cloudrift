import Table from 'cli-table3';
import chalk from 'chalk';
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  groupByKind,
} from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import { presenterFor } from './resource-presenters';

export interface TableReportMeta {
  pricesAsOf: string;
}

export function formatWasteReportAsTable(
  summary: WastedResourcesSummary,
  meta: TableReportMeta,
): string {
  const lines: string[] = [];
  const grouped = groupByKind(summary.findings);

  for (const kind of RESOURCE_KINDS) {
    const findings = grouped[kind];
    if (findings.length === 0) continue;

    const presenter = presenterFor(kind);
    lines.push(chalk.bold.yellow(`\n  ${presenter.title}`));

    const table = new Table({
      head: [...presenter.head, 'Est. Cost'],
      style: { head: ['cyan'] },
    });
    for (const finding of findings) {
      table.push([...presenter.row(finding), chalk.red(finding.costEstimate.format())]);
    }
    lines.push(table.toString());
  }

  if (summary.findings.length === 0 && summary.scanErrors.length === 0) {
    lines.push(chalk.green('\n  No wasted resources found.'));
  }

  if (summary.scanErrors.length > 0) {
    lines.push(
      chalk.bold.yellow(
        '\n  Scan warnings — partial results (some scans could not complete):',
      ),
    );
    for (const { kind, region, error } of summary.scanErrors) {
      lines.push(
        chalk.yellow(`    • ${RESOURCE_KIND_LABELS[kind]} in ${region}: ${error.message}`),
      );
    }
  }

  lines.push(
    chalk.bold(
      `\n  Total estimated waste: ${chalk.red(`$${summary.totalMonthlyCostUsd.toFixed(2)}/month`)}${summary.scanErrors.length > 0 ? chalk.yellow(' (incomplete — see warnings above)') : ''}`,
    ),
  );
  lines.push(
    chalk.dim(
      `  Estimates based on AWS list prices as of ${meta.pricesAsOf}; actual billing may differ.\n`,
    ),
  );

  return lines.join('\n');
}
