// SPDX-License-Identifier: Apache-2.0
import Table from 'cli-table3';
import chalk from 'chalk';
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_META,
  groupByKind,
} from 'cloud-cost-domain';
import type { FindingCategory, WastedResourcesSummary } from 'cloud-cost-domain';
import { REPORT_CONTACT } from 'cloud-cost-application';
import { presenterFor, rowFor } from './resource-presenters';

export interface TableReportMeta {
  pricesAsOf: string;
}

export function formatWasteReportAsTable(
  summary: WastedResourcesSummary,
  meta: TableReportMeta,
): string {
  const lines: string[] = [];
  const grouped = groupByKind(summary.findings);

  const renderKindTables = (category: FindingCategory): boolean => {
    let rendered = false;
    for (const kind of RESOURCE_KINDS) {
      if (RESOURCE_KIND_META[kind].category !== category) continue;
      const findings = grouped[kind];
      if (findings.length === 0) continue;
      rendered = true;

      const presenter = presenterFor(kind);
      lines.push(chalk.bold.yellow(`\n  ${presenter.title}`));
      const table = new Table({
        head: [...presenter.head, 'Est. Cost'],
        style: { head: ['cyan'] },
      });
      for (const finding of findings) {
        table.push([...rowFor(finding), chalk.red(finding.costEstimate.format())]);
      }
      lines.push(table.toString());
    }
    return rendered;
  };

  renderKindTables('waste');

  // Separate section: savings opportunities, NOT counted in the waste total.
  const hasOptimizations = summary.totalOptimizationMonthlyUsd > 0 ||
    RESOURCE_KINDS.some((k) => RESOURCE_KIND_META[k].category === 'optimization' && grouped[k].length > 0);
  if (hasOptimizations) {
    lines.push(
      chalk.bold.cyan('\n  ── Optimization opportunities (savings — verify before acting) ──'),
    );
    renderKindTables('optimization');
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

  const incomplete = summary.scanErrors.length > 0
    ? chalk.yellow(' (incomplete — see warnings above)')
    : '';
  lines.push(
    chalk.bold(
      `\n  Total waste: ${chalk.red(`$${summary.totalWasteMonthlyUsd.toFixed(2)}/month`)}${incomplete}`,
    ),
  );
  if (summary.totalOptimizationMonthlyUsd > 0) {
    lines.push(
      chalk.cyan(
        `  Optimization opportunities: $${summary.totalOptimizationMonthlyUsd.toFixed(2)}/month ` +
          `(savings, not counted in the waste total)`,
      ),
    );
  }
  lines.push(
    chalk.dim(
      `  Estimates based on AWS list prices as of ${meta.pricesAsOf}; actual billing may differ.`,
    ),
  );
  lines.push(
    chalk.dim(
      `  Contact: ${REPORT_CONTACT.email} · ${REPORT_CONTACT.github} · ${REPORT_CONTACT.linkedin}\n`,
    ),
  );

  return lines.join('\n');
}
