// SPDX-License-Identifier: Apache-2.0
import type { TrendSnapshotRecord } from 'shared-trend-store';
import { summarize } from './trend-history.table-formatter';

const SPARKLINE_LEVELS = '▁▂▃▄▅▆▇█';

/**
 * Renders `values` (oldest first) as a one-line Unicode block sparkline —
 * the only "chart" shape that survives GitHub's job-summary Markdown
 * sanitizer intact (no inline SVG/`<script>`/chart library, which a job
 * summary either strips or can't run). A flat series (including a single
 * point) renders as the middle level rather than dividing by zero.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return SPARKLINE_LEVELS[3].repeat(values.length);
  return values
    .map((value) => SPARKLINE_LEVELS[Math.round(((value - min) / (max - min)) * (SPARKLINE_LEVELS.length - 1))])
    .join('');
}

/**
 * `records` come from `readTrendSnapshots` most-recent-first (matching
 * `formatTrendHistoryAsTable`'s row order); the sparkline reads left-to-right
 * as time increasing, so it reverses to oldest-first just for that line.
 */
export function formatTrendHistoryAsMarkdown(records: TrendSnapshotRecord[]): string {
  if (records.length === 0) {
    return 'No trend history yet for this account — run analyze / dead-resources / resource-security at least once to start building it.';
  }

  const summaries = records.map(summarize);
  // `monthlyWasteUsd` (dollars) when present, else `count` (a plain integer,
  // for dead-resources/resource-security) — the two domains this can mix
  // format differently in the caption below, so it's tracked alongside each value.
  const chartPoints = summaries.map((s) => ({ value: s.monthlyWasteUsd ?? s.count, isCount: s.monthlyWasteUsd === undefined })).reverse();
  const chartValues = chartPoints.map((p) => p.value);
  const formatPoint = (p: (typeof chartPoints)[number]) => (p.isCount ? String(p.value) : `$${p.value.toFixed(2)}`);

  const lines = [
    `**Trend (last ${records.length} run${records.length === 1 ? '' : 's'})**`,
    '',
    `\`${sparkline(chartValues)}\` (${formatPoint(chartPoints[0])} → ${formatPoint(chartPoints[chartPoints.length - 1])})`,
    '',
    '| Date | Domain | Findings | Monthly waste |',
    '|---|---|---|---|',
  ];

  for (let i = 0; i < records.length; i++) {
    const { count, monthlyWasteUsd } = summaries[i];
    lines.push(`| ${records[i].generatedAt.split('T')[0]} | ${records[i].domain} | ${count} | ${monthlyWasteUsd !== undefined ? `$${monthlyWasteUsd.toFixed(2)}` : '—'} |`);
  }

  return lines.join('\n');
}
