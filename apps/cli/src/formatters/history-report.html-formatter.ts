// SPDX-License-Identifier: Apache-2.0
import type { TrendDomain, TrendSnapshotRecord } from 'shared-trend-store';
import { compareCloudCostSnapshots, compareHygieneSnapshots } from '../commands/history-comparison';
import type { WasteReportDto } from 'cloud-cost-application';
import type { DeadResourcesReportDto } from 'dead-resources-application';
import type { ResourceSecurityReportDto } from 'resource-security-application';

interface DataPoint {
  readonly date: string;
  readonly value: number;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 320;
const PADDING = { top: 24, right: 24, bottom: 40, left: 56 };
const MAX_X_LABELS = 8;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractPoints(records: readonly TrendSnapshotRecord[], domain: TrendDomain): DataPoint[] {
  // `records` arrives most-recent-first (readTrendSnapshots' own ordering); a
  // chart reads left-to-right as oldest-to-newest, so reverse it here once.
  const chronological = [...records].reverse();
  return chronological.map((record) => {
    const payload = JSON.parse(record.payload) as { totalWasteMonthlyUsd?: number; countBySeverity?: Record<string, number> };
    const value =
      domain === 'cloud-cost'
        ? (payload.totalWasteMonthlyUsd ?? 0)
        : Object.values(payload.countBySeverity ?? {}).reduce((sum, n) => sum + n, 0);
    return { date: record.generatedAt.split('T')[0], value };
  });
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function buildChartSvg(points: DataPoint[], valueLabel: string, valuePrefix: string): string {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const maxValue = niceMax(Math.max(...points.map((p) => p.value), 0));
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const xAt = (i: number) => PADDING.left + i * stepX;
  const yAt = (value: number) => PADDING.top + plotHeight - (value / maxValue) * plotHeight;

  const gridlineCount = 4;
  const gridlines: string[] = [];
  const yTicks: string[] = [];
  for (let i = 0; i <= gridlineCount; i++) {
    const value = (maxValue / gridlineCount) * i;
    const y = yAt(value);
    gridlines.push(`<line class="viz-gridline" x1="${PADDING.left}" y1="${y}" x2="${CHART_WIDTH - PADDING.right}" y2="${y}" />`);
    yTicks.push(`<text class="viz-tick" x="${PADDING.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${valuePrefix}${Math.round(value).toLocaleString()}</text>`);
  }

  const labelEvery = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const xTicks = points
    .map((p, i) => (i % labelEvery === 0 || i === points.length - 1 ? `<text class="viz-tick" x="${xAt(i)}" y="${CHART_HEIGHT - PADDING.bottom + 20}" text-anchor="middle">${escapeHtml(p.date)}</text>` : ''))
    .join('');

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(points.length - 1)} ${yAt(0)} L ${xAt(0)} ${yAt(0)} Z`;

  const dots = points
    .map(
      (p, i) =>
        `<circle class="viz-dot" data-index="${i}" cx="${xAt(i)}" cy="${yAt(p.value)}" r="5" />`,
    )
    .join('');

  const last = points[points.length - 1];
  const endLabel =
    points.length > 0
      ? `<text class="viz-end-label" x="${xAt(points.length - 1)}" y="${yAt(last.value) - 12}" text-anchor="end">${valuePrefix}${last.value.toLocaleString()}</text>`
      : '';

  return `
<svg class="viz-svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeHtml(valueLabel)} over time">
  ${gridlines.join('\n  ')}
  <path class="viz-area" d="${areaPath}" />
  <path class="viz-line" d="${linePath}" />
  ${dots}
  ${endLabel}
  ${yTicks.join('\n  ')}
  ${xTicks}
  <line class="viz-crosshair" x1="0" y1="${PADDING.top}" x2="0" y2="${CHART_HEIGHT - PADDING.bottom}" style="display:none" />
</svg>`;
}

function buildTableRows(records: readonly TrendSnapshotRecord[], domain: TrendDomain): string {
  return records
    .map((record) => {
      const payload = JSON.parse(record.payload) as { totalWasteMonthlyUsd?: number; countBySeverity?: Record<string, number>; findings?: unknown[] };
      const findingsCount = domain === 'cloud-cost' ? (payload.findings?.length ?? 0) : Object.values(payload.countBySeverity ?? {}).reduce((sum, n) => sum + n, 0);
      const cost = domain === 'cloud-cost' ? `$${(payload.totalWasteMonthlyUsd ?? 0).toFixed(2)}` : '—';
      return `<tr><td>${escapeHtml(record.generatedAt.split('T')[0])}</td><td>${escapeHtml(domain)}</td><td>${findingsCount}</td><td>${cost}</td></tr>`;
    })
    .join('\n');
}

function buildSummary(records: readonly TrendSnapshotRecord[], domain: TrendDomain): string {
  if (records.length < 2) return '';
  const newer = records[0];
  const older = records[records.length - 1];

  if (domain === 'cloud-cost') {
    const comparison = compareCloudCostSnapshots(JSON.parse(older.payload) as WasteReportDto, JSON.parse(newer.payload) as WasteReportDto);
    const deltaClass = comparison.deltaUsd > 0 ? 'viz-delta-bad' : comparison.deltaUsd < 0 ? 'viz-delta-good' : '';
    return `<p class="viz-summary">Monthly waste: <strong>$${comparison.olderTotalWasteMonthlyUsd.toFixed(2)}</strong> → <strong>$${comparison.newerTotalWasteMonthlyUsd.toFixed(2)}</strong>
      <span class="${deltaClass}">(${comparison.deltaUsd >= 0 ? '+' : ''}$${comparison.deltaUsd.toFixed(2)})</span>
      — presumed resolved: <strong>$${comparison.presumedResolvedMonthlyUsd.toFixed(2)}/mo</strong> across ${comparison.resolvedFindings.length} finding(s) no longer present.
      This is an inference (findings absent from the latest run), not a confirmed saving — cloudrift never remediates anything itself.</p>`;
  }

  const comparison = compareHygieneSnapshots(
    domain,
    JSON.parse(older.payload) as DeadResourcesReportDto | ResourceSecurityReportDto,
    JSON.parse(newer.payload) as DeadResourcesReportDto | ResourceSecurityReportDto,
  );
  return `<p class="viz-summary">Resolved <strong>${comparison.resolvedFindings.length}</strong> finding(s), <strong>${comparison.newFindings.length}</strong> new, across the period shown.</p>`;
}

/**
 * One domain's chart + summary + table, as a standalone `<div class="viz-card">`.
 * Points are embedded as a sibling `application/json` script tag (not a JS
 * variable) so the page-level script below can support any number of these
 * cards on one page via `querySelectorAll` instead of a single global chart.
 */
function buildDomainSection(records: readonly TrendSnapshotRecord[], domain: TrendDomain): string {
  const points = extractPoints(records, domain);
  const valueLabel = domain === 'cloud-cost' ? 'Monthly waste (USD)' : 'Findings';
  const valuePrefix = domain === 'cloud-cost' ? '$' : '';
  const chartSvg = points.length > 0 ? buildChartSvg(points, valueLabel, valuePrefix) : '';
  const tableRows = buildTableRows(records, domain);
  const summary = buildSummary(records, domain);
  const pointsJson = JSON.stringify(points).replace(/</g, '\\u003c');

  return `
  <div class="viz-card">
    <h2>${escapeHtml(domain)} — local scan history</h2>
    <p class="viz-subtitle">${records.length} run(s) on record</p>
    ${summary}
    <div class="viz-chart-wrap" data-value-prefix="${escapeHtml(valuePrefix)}">
      ${chartSvg}
      <script type="application/json" class="viz-points">${pointsJson}</script>
      <div class="viz-tooltip"><div class="viz-tooltip-date"></div><div class="viz-tooltip-value"></div></div>
    </div>
    <table class="viz-table">
      <thead><tr><th>Date</th><th>Domain</th><th>Findings</th><th>Monthly waste</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`;
}

const PAGE_STYLE = `
  .viz-root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --series-1: #2a78d6;
    --good: #006300;
    --bad: #d03b3b;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page);
    color: var(--text-primary);
    margin: 0;
    padding: 32px;
  }
  @media (prefers-color-scheme: dark) {
    .viz-root {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --series-1: #3987e5;
      --good: #0ca30c;
      --bad: #e66767;
    }
  }
  .viz-page { max-width: 800px; margin: 0 auto; }
  .viz-card { background: var(--surface-1); border-radius: 8px; padding: 24px; margin: 0 0 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 0 0 4px; }
  .viz-subtitle { color: var(--text-secondary); font-size: 13px; margin: 0 0 20px; }
  .viz-summary { color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
  .viz-summary strong { color: var(--text-primary); }
  .viz-delta-good { color: var(--good); }
  .viz-delta-bad { color: var(--bad); }
  .viz-svg { width: 100%; height: auto; overflow: visible; }
  .viz-gridline { stroke: var(--gridline); stroke-width: 1; }
  .viz-line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .viz-area { fill: var(--series-1); opacity: 0.1; stroke: none; }
  .viz-dot { fill: var(--series-1); stroke: var(--surface-1); stroke-width: 2; }
  .viz-end-label { fill: var(--text-primary); font-size: 13px; font-weight: 600; }
  .viz-tick { fill: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .viz-crosshair { stroke: var(--baseline); stroke-width: 1; }
  .viz-tooltip {
    position: absolute; display: none; pointer-events: none;
    background: var(--surface-1); color: var(--text-primary);
    border: 1px solid var(--gridline); border-radius: 4px; padding: 6px 10px;
    font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  .viz-tooltip .viz-tooltip-value { font-weight: 600; }
  .viz-tooltip .viz-tooltip-date { color: var(--text-secondary); }
  table.viz-table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 13px; }
  table.viz-table th, table.viz-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--gridline); }
  table.viz-table th { color: var(--text-muted); font-weight: 600; }
  table.viz-table td:nth-child(3), table.viz-table td:nth-child(4) { font-variant-numeric: tabular-nums; }
  .viz-chart-wrap { position: relative; }`;

/**
 * Wires up every `.viz-chart-wrap` on the page independently (one page can
 * hold one card or several stacked ones — see `generateCombinedHistoryReportHtml`),
 * reading each chart's own points from its sibling `application/json` script
 * instead of a single page-wide variable.
 */
const PAGE_SCRIPT = `
    (function () {
      document.querySelectorAll('.viz-chart-wrap').forEach(function (wrap) {
        var svg = wrap.querySelector('.viz-svg');
        var pointsTag = wrap.querySelector('.viz-points');
        var points = pointsTag ? JSON.parse(pointsTag.textContent) : [];
        if (!svg || points.length === 0) return;
        var crosshair = svg.querySelector('.viz-crosshair');
        var tooltip = wrap.querySelector('.viz-tooltip');
        var dateEl = tooltip.querySelector('.viz-tooltip-date');
        var valueEl = tooltip.querySelector('.viz-tooltip-value');
        var dots = Array.prototype.slice.call(svg.querySelectorAll('.viz-dot'));
        var valuePrefix = wrap.getAttribute('data-value-prefix') || '';

        function showAt(index) {
          var dot = dots[index];
          if (!dot) return;
          var cx = parseFloat(dot.getAttribute('cx'));
          var cy = parseFloat(dot.getAttribute('cy'));
          crosshair.setAttribute('x1', cx);
          crosshair.setAttribute('x2', cx);
          crosshair.style.display = 'block';
          var point = points[index];
          dateEl.textContent = point.date;
          valueEl.textContent = valuePrefix + point.value.toLocaleString();
          var rect = svg.getBoundingClientRect();
          var scale = rect.width / ${CHART_WIDTH};
          tooltip.style.left = (cx * scale + 12) + 'px';
          tooltip.style.top = (cy * scale - 8) + 'px';
          tooltip.style.display = 'block';
        }

        function hide() {
          crosshair.style.display = 'none';
          tooltip.style.display = 'none';
        }

        svg.addEventListener('mousemove', function (event) {
          var rect = svg.getBoundingClientRect();
          var scale = ${CHART_WIDTH} / rect.width;
          var localX = (event.clientX - rect.left) * scale;
          var nearest = 0;
          var nearestDist = Infinity;
          dots.forEach(function (dot, i) {
            var dist = Math.abs(parseFloat(dot.getAttribute('cx')) - localX);
            if (dist < nearestDist) { nearestDist = dist; nearest = i; }
          });
          showAt(nearest);
        });
        svg.addEventListener('mouseleave', hide);
      });
    })();`;

function buildPage(title: string, subtitle: string, sectionsHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}
</style>
</head>
<body class="viz-root">
  <div class="viz-page">
    <h1>${escapeHtml(title)}</h1>
    <p class="viz-subtitle">${subtitle}</p>
    ${sectionsHtml}
  </div>
  <script>${PAGE_SCRIPT}
  </script>
</body>
</html>`;
}

/**
 * Self-contained HTML report for one domain's trend history: a single-series
 * line chart (inline SVG, zero chart-library dependency) plus its
 * table-view twin, per the project's dataviz conventions — hand-rolled SVG
 * over a bundled charting library or a CDN script, consistent with why
 * `pdfkit` was chosen over a headless browser (no heavy dependency, fully
 * offline, nothing ever leaves the machine).
 */
export function generateHistoryReportHtml(records: readonly TrendSnapshotRecord[], domain: TrendDomain, accountId: string): string {
  const title = `cloudrift — ${domain} history`;
  const subtitle = `Account ${escapeHtml(accountId)} · ${records.length} run(s) on record · generated locally, never uploaded anywhere`;
  return buildPage(title, subtitle, buildDomainSection(records, domain));
}

/**
 * Same report, but stacking all three tracked domains (cloud-cost,
 * dead-resources, resource-security) as separate cards on one page instead
 * of writing three files — `history --html` without `--domain` picks this.
 */
export function generateCombinedHistoryReportHtml(recordsByDomain: Readonly<Record<TrendDomain, readonly TrendSnapshotRecord[]>>, accountId: string): string {
  const domains: TrendDomain[] = ['cloud-cost', 'dead-resources', 'resource-security'];
  const title = 'cloudrift — scan history';
  const subtitle = `Account ${escapeHtml(accountId)} · generated locally, never uploaded anywhere`;
  const sections = domains.map((domain) => buildDomainSection(recordsByDomain[domain], domain)).join('\n');
  return buildPage(title, subtitle, sections);
}
