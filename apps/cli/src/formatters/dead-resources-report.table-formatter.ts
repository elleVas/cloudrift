// SPDX-License-Identifier: Apache-2.0
import Table from 'cli-table3';
import chalk from 'chalk';
import { DEAD_RESOURCE_KINDS, groupByKind } from 'dead-resources-domain';
import type { DeadResourcesSummary, DeadResourceSeverity } from 'dead-resources-domain';
import { REPORT_CONTACT } from 'cloud-cost-application';
import { presenterFor, rowFor } from './dead-resource-presenters';

const SEVERITY_COLOR: Record<DeadResourceSeverity, (text: string) => string> = {
  info: chalk.dim,
  warning: chalk.yellow,
  critical: chalk.red,
};

export function formatDeadResourcesReportAsTable(summary: DeadResourcesSummary): string {
  const lines: string[] = [];
  const grouped = groupByKind(summary.findings);

  let rendered = false;
  for (const kind of DEAD_RESOURCE_KINDS) {
    const findings = grouped[kind];
    if (findings.length === 0) continue;
    rendered = true;

    const presenter = presenterFor(kind);
    lines.push(chalk.bold.yellow(`\n  ${presenter.title}`));
    const table = new Table({ head: [...presenter.head, 'Severity'], style: { head: ['cyan'] } });
    for (const finding of findings) {
      table.push([...rowFor(finding), SEVERITY_COLOR[finding.severity](finding.severity)]);
    }
    lines.push(table.toString());
  }

  if (!rendered && summary.scanErrors.length === 0) {
    lines.push(chalk.green('\n  No dead/unused resources found.'));
  }

  if (summary.scanErrors.length > 0) {
    lines.push(chalk.bold.yellow('\n  Scan warnings — partial results (some scans could not complete):'));
    for (const { kind, region, error } of summary.scanErrors) {
      lines.push(chalk.yellow(`    • ${kind} in ${region}: ${error.message}`));
    }
  }

  const incomplete = summary.scanErrors.length > 0 ? chalk.yellow(' (incomplete — see warnings above)') : '';
  const { info, warning, critical } = summary.countBySeverity;
  lines.push(
    chalk.bold(
      `\n  Total: ${summary.findings.length} finding(s)${incomplete} — ` +
        `${critical} critical, ${warning} warning, ${info} info`,
    ),
  );
  lines.push(chalk.dim(`  Contact: ${REPORT_CONTACT.email} · ${REPORT_CONTACT.github} · ${REPORT_CONTACT.linkedin}\n`));

  return lines.join('\n');
}
