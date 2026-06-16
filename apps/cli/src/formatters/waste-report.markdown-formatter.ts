import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  groupByKind,
} from 'cloud-cost-domain';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { presenterFor } from './resource-presenters';

export interface MarkdownReportOptions {
  /** Se valorizzata, il report mostra se il totale supera la soglia (CI). */
  costAlertThresholdUsd?: number;
}

const MAX_RECOMMENDATIONS = 10;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Neutralizza i caratteri che romperebbero una cella di tabella markdown. */
function esc(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function footer(meta: WasteReportMeta): string {
  return `---\n<sub>Estimates use AWS list prices as of ${meta.pricesAsOf}; actual billing may differ.</sub>`;
}

/**
 * Render Markdown pensato per i commenti automatici sulle Pull Request
 * (GitHub Actions / GitLab CI). Usa `<details>` per restare compatto e mette
 * il totale e l'eventuale sforamento di soglia ben in vista.
 */
export function formatWasteReportAsMarkdown(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
  options: MarkdownReportOptions = {},
): string {
  const lines: string[] = [];
  const grouped = groupByKind(summary.findings);
  const total = summary.totalMonthlyCostUsd;
  const day = meta.generatedAt.toISOString().split('T')[0];

  lines.push('## ☁️ cloudrift — Cloud waste report');
  lines.push('');
  const accountLabel =
    meta.accountId !== 'unknown' ? `account \`${meta.accountId}\` · ` : '';
  lines.push(`> ${accountLabel}regions \`${meta.regions.join(', ')}\` · ${day}`);
  lines.push('');

  if (summary.findings.length === 0 && summary.scanErrors.length === 0) {
    lines.push('✅ **No wasted resources found.**');
    lines.push('');
    lines.push(footer(meta));
    return lines.join('\n');
  }

  // Headline
  lines.push(
    `**💸 ${money(total)}/month** potential savings ` +
      `(**${money(total * 12)}/year**) across ${summary.findings.length} resource(s).`,
  );
  if (options.costAlertThresholdUsd !== undefined) {
    lines.push('');
    lines.push(
      total > options.costAlertThresholdUsd
        ? `> ⚠️ **Over the ${money(options.costAlertThresholdUsd)}/mo threshold** — this pipeline should fail.`
        : `> ✅ Under the ${money(options.costAlertThresholdUsd)}/mo threshold.`,
    );
  }
  lines.push('');

  // Breakdown table
  lines.push('### Breakdown');
  lines.push('');
  lines.push('| Resource type | Count | $/month |');
  lines.push('|---|---:|---:|');
  for (const kind of RESOURCE_KINDS) {
    const findings = grouped[kind];
    if (findings.length === 0) continue;
    const subtotal = findings.reduce((s, r) => s + r.costEstimate.monthlyCostUsd, 0);
    lines.push(`| ${RESOURCE_KIND_LABELS[kind]} | ${findings.length} | ${money(subtotal)} |`);
  }
  lines.push(`| **Total** | **${summary.findings.length}** | **${money(total)}** |`);
  lines.push('');

  // Dettaglio per tipo (collassabile per mantenere il commento PR compatto)
  for (const kind of RESOURCE_KINDS) {
    const findings = grouped[kind];
    if (findings.length === 0) continue;
    const presenter = presenterFor(kind);
    const subtotal = findings.reduce((s, r) => s + r.costEstimate.monthlyCostUsd, 0);

    lines.push('<details>');
    lines.push(
      `<summary>${esc(presenter.title)} (${findings.length}) · ${money(subtotal)}/mo</summary>`,
    );
    lines.push('');
    const header = [...presenter.head, '$/mo'];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`|${header.map(() => '---').join('|')}|`);
    for (const finding of findings) {
      const cells = [
        ...presenter.row(finding).map(esc),
        money(finding.costEstimate.monthlyCostUsd),
      ];
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Raccomandazioni principali (ordinate per costo decrescente)
  const recommendations = RESOURCE_KINDS.flatMap((kind) =>
    grouped[kind].map((finding) => ({
      text: presenterFor(kind).recommend(finding),
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

  // Errori di scan: risultati parziali
  if (summary.scanErrors.length > 0) {
    lines.push('> ⚠️ **Partial results** — some scans could not complete:');
    for (const { kind, region, error } of summary.scanErrors) {
      lines.push(`> - ${RESOURCE_KIND_LABELS[kind]} in ${region}: ${esc(error.message)}`);
    }
    lines.push('');
  }

  lines.push(footer(meta));
  return lines.join('\n');
}
