// SPDX-License-Identifier: Apache-2.0
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_META,
  groupByKind,
  confidenceOf,
} from 'cloud-cost-domain';
import type {
  FindingCategory,
  WastedResourcesSummary,
} from 'cloud-cost-domain';
import { REPORT_CONTACT, REPORT_DISCLAIMER, isPricesStale, PRICES_STALE_AFTER_DAYS } from 'cloud-cost-application';
import { presenterFor, rowFor, recommendFor } from './resource-presenters';

export interface MarkdownReportOptions {
  /** If set, the report shows whether the TOTAL WASTE exceeds the threshold (CI). */
  costAlertThresholdUsd?: number;
}

const MAX_RECOMMENDATIONS = 10;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Neutralizes characters that would break a markdown table cell. */
function esc(cell: string): string {
  return cell
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\');
}

function footer(meta: { pricesAsOf: string; generatedAt: Date }): string {
  const staleWarning = isPricesStale(meta.pricesAsOf, meta.generatedAt)
    ? `\n> ⚠️ Price list is over ${PRICES_STALE_AFTER_DAYS} days old — consider running with \`--live-pricing\` for fresher estimates.\n`
    : '';
  return (
    `---\n<sub>Estimates use AWS list prices as of ${meta.pricesAsOf}; actual billing may differ.</sub>\n` +
    staleWarning +
    `\n<sub>${REPORT_DISCLAIMER}</sub>\n\n` +
    `<sub>Contact: ${REPORT_CONTACT.email} · ` +
      `<a href="${REPORT_CONTACT.github}" target="_blank" rel="noopener noreferrer">GitHub</a> · ` +
      `<a href="${REPORT_CONTACT.linkedin}" target="_blank" rel="noopener noreferrer">LinkedIn</a></sub>`
  );
}

/**
 * Markdown render designed for automated comments on Pull Requests.
 * The headline and CI threshold are based on the **total waste**; the
 * optimization opportunities (gp2→gp3, rightsizing) are in a separate section.
 */
export function formatWasteReportAsMarkdown(
  summary: WastedResourcesSummary,
  meta: {
    accountId: string;
    regions: string[];
    generatedAt: Date;
    pricesAsOf: string;
  },
  options: MarkdownReportOptions = {},
): string {
  const lines: string[] = [];
  const grouped = groupByKind(summary.findings);
  const waste = summary.totalWasteMonthlyUsd;
  const day = meta.generatedAt.toISOString().split('T')[0];

  const kindsOf = (category: FindingCategory) =>
    RESOURCE_KINDS.filter(
      (k) =>
        RESOURCE_KIND_META[k].category === category && grouped[k].length > 0,
    );
  const countOf = (category: FindingCategory) =>
    kindsOf(category).reduce((n, k) => n + grouped[k].length, 0);

  lines.push('## ☁️ cloudrift — Cloud waste report');
  lines.push('');
  const accountLabel =
    meta.accountId !== 'unknown' ? `account \`${meta.accountId}\` · ` : '';
  lines.push(
    `> ${accountLabel}regions \`${meta.regions.join(', ')}\` · ${day}`,
  );
  lines.push('');

  if (summary.findings.length === 0 && summary.scanErrors.length === 0) {
    lines.push('✅ **No wasted resources found.**');
    lines.push('');
    lines.push(footer(meta));
    return lines.join('\n');
  }

  // Headline: waste only.
  lines.push(
    `**💸 ${money(waste)}/month** of waste ` +
      `(**${money(waste * 12)}/year**) across ${countOf('waste')} resource(s).`,
  );
  if (options.costAlertThresholdUsd !== undefined) {
    lines.push('');
    lines.push(
      waste > options.costAlertThresholdUsd
        ? `> ⚠️ **Over the ${money(options.costAlertThresholdUsd)}/mo waste threshold** — this pipeline should fail.`
        : `> ✅ Under the ${money(options.costAlertThresholdUsd)}/mo waste threshold.`,
    );
  }
  lines.push('');

  // Waste breakdown.
  lines.push('### Waste breakdown');
  lines.push('');
  lines.push('| Resource type | Count | $/month |');
  lines.push('|---|---:|---:|');
  for (const kind of kindsOf('waste')) {
    const subtotal = grouped[kind].reduce(
      (s, r) => s + r.costEstimate.monthlyCostUsd,
      0,
    );
    lines.push(
      `| ${RESOURCE_KIND_LABELS[kind]} | ${grouped[kind].length} | ${money(subtotal)} |`,
    );
  }
  lines.push(
    `| **Total waste (measured)** | **${countOf('waste')}** | **${money(waste)}** |`,
  );
  lines.push('');

  renderDetails('waste');

  // Optimization section (separate, not in the waste total).
  if (countOf('optimization') > 0) {
    lines.push('### Optimization opportunities');
    lines.push('');
    lines.push(
      '> Savings you can capture **without deleting** the resource, derived from real price ' +
        'differences (not counted in the waste total above, and not a blind percentage). ' +
        'Items marked _derived_ still need verification; items marked _no $ estimate_ are ' +
        'namespace-hygiene flags with no real dollar basis to report.',
    );
    lines.push('');
    lines.push('| Resource type | Count | $/month |');
    lines.push('|---|---:|---:|');
    for (const kind of kindsOf('optimization')) {
      const subtotal = grouped[kind].reduce(
        (s, r) => s + r.costEstimate.monthlyCostUsd,
        0,
      );
      const confidence = confidenceOf(kind);
      const label = confidence === 'derived'
        ? `${RESOURCE_KIND_LABELS[kind]} _(derived)_`
        : confidence === 'heuristic'
          ? `${RESOURCE_KIND_LABELS[kind]} _(no $ estimate)_`
          : RESOURCE_KIND_LABELS[kind];
      const costCell = confidence === 'heuristic' ? 'no $ basis' : money(subtotal);
      lines.push(`| ${label} | ${grouped[kind].length} | ${costCell} |`);
    }
    lines.push(
      `| **Total optimization (derived)** | **${countOf('optimization')}** | **${money(summary.totalOptimizationMonthlyUsd)}** |`,
    );
    lines.push('');
    renderDetails('optimization');
  }

  // Top recommendations (sorted by descending cost, all categories).
  const recommendations = RESOURCE_KINDS.flatMap((kind) =>
    grouped[kind].map((finding) => ({
      text: recommendFor(finding),
      cost: finding.costEstimate.monthlyCostUsd,
    })),
  ).sort((a, b) => b.cost - a.cost);

  if (recommendations.length > 0) {
    lines.push('### Top recommendations');
    lines.push('');
    for (const { text } of recommendations.slice(0, MAX_RECOMMENDATIONS)) {
      lines.push(`- ${esc(text)}`);
    }
    if (recommendations.length > MAX_RECOMMENDATIONS) {
      lines.push(`- …and ${recommendations.length - MAX_RECOMMENDATIONS} more`);
    }
    lines.push('');
  }

  if (summary.scanErrors.length > 0) {
    lines.push('> ⚠️ **Partial results** — some scans could not complete:');
    for (const { kind, region, error } of summary.scanErrors) {
      lines.push(
        `> - ${RESOURCE_KIND_LABELS[kind]} in ${region}: ${esc(error.message)}`,
      );
    }
    lines.push('');
  }

  lines.push(footer(meta));
  return lines.join('\n');

  function renderDetails(category: FindingCategory): void {
    for (const kind of kindsOf(category)) {
      const presenter = presenterFor(kind);
      const subtotal = grouped[kind].reduce(
        (s, r) => s + r.costEstimate.monthlyCostUsd,
        0,
      );
      lines.push('<details>');
      lines.push(
        `<summary>${esc(presenter.title)} (${grouped[kind].length}) · ${money(subtotal)}/mo</summary>`,
      );
      lines.push('');
      const header = [...presenter.head, '$/mo'];
      lines.push(`| ${header.join(' | ')} |`);
      lines.push(`|${header.map(() => '---').join('|')}|`);
      for (const finding of grouped[kind]) {
        const cells = [
          ...rowFor(finding).map(esc),
          money(finding.costEstimate.monthlyCostUsd),
        ];
        lines.push(`| ${cells.join(' | ')} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }
}
