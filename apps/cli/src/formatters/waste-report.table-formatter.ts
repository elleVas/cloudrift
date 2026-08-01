// SPDX-License-Identifier: Apache-2.0
import Table from 'cli-table3';
import chalk from 'chalk';
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_META,
  groupByKind,
  confidenceOf,
} from 'cloud-cost-domain';
import type { FindingCategory, WastedResourcesSummary } from 'cloud-cost-domain';
import { REPORT_CONTACT, isPricesStale, PRICES_STALE_AFTER_DAYS } from 'cloud-cost-application';
import { presenterFor, rowFor } from './resource-presenters';

export interface TableReportMeta {
  pricesAsOf: string;
  generatedAt: Date;
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
      const confidence = confidenceOf(kind);
      lines.push(chalk.bold.yellow(`\n  ${presenter.title}`));
      const table = new Table({
        head: [...presenter.head, confidence === 'heuristic' ? 'Cost' : 'Est. Cost'],
        style: { head: ['cyan'] },
      });
      for (const finding of findings) {
        // Heuristic kinds always cost $0 by construction (see entity docs):
        // showing "$0.00/mo" would read as "confirmed no waste" instead of
        // "we chose not to guess" — say so explicitly instead.
        const costCell = confidence === 'heuristic'
          ? chalk.gray('no $ basis')
          : chalk.red(finding.costEstimate.format());
        table.push([...rowFor(finding), costCell]);
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
      chalk.bold.cyan(
        '\n  ── Optimization opportunities (derived from real prices where possible, or hygiene-only — verify before acting) ──',
      ),
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
      `\n  Total waste (measured): ${chalk.red(`$${summary.totalWasteMonthlyUsd.toFixed(2)}/month`)}${incomplete}`,
    ),
  );
  if (summary.totalOptimizationMonthlyUsd > 0) {
    lines.push(
      chalk.cyan(
        `  + $${summary.totalOptimizationMonthlyUsd.toFixed(2)}/month derived (real price differences, not included in the total above — verify before acting)`,
      ),
    );
  }
  lines.push(
    chalk.dim(
      `  Estimates based on AWS list prices as of ${meta.pricesAsOf}; actual billing may differ.`,
    ),
  );
  if (isPricesStale(meta.pricesAsOf, meta.generatedAt)) {
    lines.push(
      chalk.yellow(
        `  ⚠ Price list is over ${PRICES_STALE_AFTER_DAYS} days old — consider running with --live-pricing for fresher estimates.`,
      ),
    );
  }
  lines.push(
    chalk.dim(
      `  Contact: ${REPORT_CONTACT.email} · ${REPORT_CONTACT.github} · ${REPORT_CONTACT.linkedin}\n`,
    ),
  );

  return lines.join('\n');
}
