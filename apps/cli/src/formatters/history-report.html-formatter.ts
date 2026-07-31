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

interface SeverityPoint {
  readonly date: string;
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

/** Fixed, never themed — same hex in light and dark, per the dataviz skill's status palette. */
const SEVERITY_SERIES = [
  { key: 'critical', color: 'var(--severity-critical)', label: 'Critical' },
  { key: 'warning', color: 'var(--severity-warning)', label: 'Warning' },
  { key: 'info', color: 'var(--text-muted)', label: 'Info' },
] as const;

const CHART_WIDTH = 720;
const CHART_HEIGHT = 320;
const PADDING = { top: 24, right: 24, bottom: 40, left: 56 };
const MAX_X_LABELS = 8;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractPoints(records: readonly TrendSnapshotRecord[]): DataPoint[] {
  // `records` arrives most-recent-first (readTrendSnapshots' own ordering); a
  // chart reads left-to-right as oldest-to-newest, so reverse it here once.
  const chronological = [...records].reverse();
  return chronological.map((record) => {
    const payload = JSON.parse(record.payload) as { totalWasteMonthlyUsd?: number };
    return { date: record.generatedAt.split('T')[0], value: payload.totalWasteMonthlyUsd ?? 0 };
  });
}

function extractSeverityPoints(records: readonly TrendSnapshotRecord[]): SeverityPoint[] {
  const chronological = [...records].reverse();
  return chronological.map((record) => {
    const payload = JSON.parse(record.payload) as { countBySeverity?: Record<string, number> };
    const bySeverity = payload.countBySeverity ?? {};
    return {
      date: record.generatedAt.split('T')[0],
      critical: bySeverity.critical ?? 0,
      warning: bySeverity.warning ?? 0,
      info: bySeverity.info ?? 0,
    };
  });
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * Simple least-squares linear regression over (index, value), extrapolated
 * one slot past the last real point — an honest "if this trend continues"
 * projection, not a forecast model. `undefined` below 2 points (no trend to
 * extrapolate) — never fabricated from a single data point.
 */
function computeForecast(points: readonly DataPoint[]): number | undefined {
  const n = points.length;
  if (n < 2) return undefined;
  const meanX = (n - 1) / 2;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (i - meanX) * (p.value - meanY);
    den += (i - meanX) ** 2;
  });
  if (den === 0) return undefined;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return Math.max(0, intercept + slope * n);
}

function buildAxes(maxValue: number, dates: readonly string[], valuePrefix: string): { gridlines: string; yTicks: string; xTicks: string; xAt: (i: number) => number; yAt: (v: number) => number } {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const stepX = dates.length > 1 ? plotWidth / (dates.length - 1) : 0;
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

  const labelEvery = Math.max(1, Math.ceil(dates.length / MAX_X_LABELS));
  const xTicks = dates
    .map((date, i) => (i % labelEvery === 0 || i === dates.length - 1 ? `<text class="viz-tick" x="${xAt(i)}" y="${CHART_HEIGHT - PADDING.bottom + 20}" text-anchor="middle">${escapeHtml(date)}</text>` : ''))
    .join('');

  return { gridlines: gridlines.join('\n  '), yTicks: yTicks.join('\n  '), xTicks, xAt, yAt };
}

/**
 * `forecastValue`, when given, extends the chart with one dashed slot past
 * the last real point (see `computeForecast`) — direct-labeled, never part
 * of the hoverable points array, since it isn't a real snapshot.
 */
function buildChartSvg(points: DataPoint[], valueLabel: string, valuePrefix: string, forecastValue?: number): string {
  const hasForecast = forecastValue !== undefined;
  const maxValue = niceMax(Math.max(...points.map((p) => p.value), forecastValue ?? 0, 0));
  const dates = hasForecast ? [...points.map((p) => p.date), 'Next'] : points.map((p) => p.date);
  const { gridlines, yTicks, xTicks, xAt, yAt } = buildAxes(maxValue, dates, valuePrefix);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(points.length - 1)} ${yAt(0)} L ${xAt(0)} ${yAt(0)} Z`;
  const dots = points.map((p, i) => `<circle class="viz-dot" data-index="${i}" cx="${xAt(i)}" cy="${yAt(p.value)}" r="5" />`).join('');

  const last = points[points.length - 1];
  const endLabel = `<text class="viz-end-label" x="${xAt(points.length - 1)}" y="${yAt(last.value) - 12}" text-anchor="end">${valuePrefix}${last.value.toLocaleString()}</text>`;

  const forecastSvg = hasForecast
    ? `<path class="viz-forecast-line" d="M ${xAt(points.length - 1)} ${yAt(last.value)} L ${xAt(points.length)} ${yAt(forecastValue)}" />
  <circle class="viz-forecast-dot" cx="${xAt(points.length)}" cy="${yAt(forecastValue)}" r="5" />
  <text class="viz-forecast-label" x="${xAt(points.length)}" y="${yAt(forecastValue) - 12}" text-anchor="end">${valuePrefix}${forecastValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} (projected)</text>`
    : '';

  return `
<svg class="viz-svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeHtml(valueLabel)} over time">
  ${gridlines}
  <path class="viz-area" d="${areaPath}" />
  <path class="viz-line" d="${linePath}" />
  ${dots}
  ${endLabel}
  ${forecastSvg}
  ${yTicks}
  ${xTicks}
  <line class="viz-crosshair" x1="0" y1="${PADDING.top}" x2="0" y2="${CHART_HEIGHT - PADDING.bottom}" style="display:none" />
</svg>`;
}

/**
 * Findings-by-severity chart for `dead-resources`/`resource-security`: three
 * lines (critical/warning/info) instead of one aggregate total, using the
 * dataviz skill's fixed status palette (never themed — same hex in light and
 * dark) so severity reads the same way it does in the PDF/table reports.
 * Per the skill's rules for ≥2 series: a legend (never color-alone), direct
 * end-labels, and a table view underneath (already part of the section).
 */
function buildSeverityChartSvg(points: SeverityPoint[]): string {
  const maxValue = niceMax(Math.max(...points.flatMap((p) => [p.critical, p.warning, p.info]), 0));
  const { gridlines, yTicks, xTicks, xAt, yAt } = buildAxes(
    maxValue,
    points.map((p) => p.date),
    '',
  );

  const legend = SEVERITY_SERIES.map(
    ({ key, label }) => `<span class="viz-legend-item"><span class="viz-legend-swatch viz-legend-swatch-${key}"></span>${label}</span>`,
  ).join('');

  const last = points[points.length - 1];
  const series = SEVERITY_SERIES.map(({ key }) => {
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p[key])}`).join(' ');
    const dots = points.map((p, i) => `<circle class="viz-dot-${key}" data-index="${i}" cx="${xAt(i)}" cy="${yAt(p[key])}" r="4" />`).join('');
    const endLabel = `<text class="viz-end-label-${key}" x="${xAt(points.length - 1)}" y="${yAt(last[key]) - 8}" text-anchor="end">${last[key].toLocaleString()}</text>`;
    return `<path class="viz-line-${key}" d="${linePath}" />\n  ${dots}\n  ${endLabel}`;
  }).join('\n  ');

  return `
<div class="viz-legend">${legend}</div>
<svg class="viz-svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Findings by severity over time">
  ${gridlines}
  ${series}
  ${yTicks}
  ${xTicks}
  <line class="viz-crosshair" x1="0" y1="${PADDING.top}" x2="0" y2="${CHART_HEIGHT - PADDING.bottom}" style="display:none" />
</svg>`;
}

function buildTableRows(records: readonly TrendSnapshotRecord[], domain: TrendDomain): string {
  if (domain === 'cloud-cost') {
    return records
      .map((record) => {
        const payload = JSON.parse(record.payload) as { totalWasteMonthlyUsd?: number; findings?: unknown[] };
        const findingsCount = payload.findings?.length ?? 0;
        const cost = `$${(payload.totalWasteMonthlyUsd ?? 0).toFixed(2)}`;
        return `<tr><td>${escapeHtml(record.generatedAt.split('T')[0])}</td><td>${escapeHtml(domain)}</td><td>${findingsCount}</td><td>${cost}</td></tr>`;
      })
      .join('\n');
  }

  return records
    .map((record) => {
      const payload = JSON.parse(record.payload) as { countBySeverity?: Record<string, number> };
      const bySeverity = payload.countBySeverity ?? {};
      return `<tr><td>${escapeHtml(record.generatedAt.split('T')[0])}</td><td>${escapeHtml(domain)}</td><td>${bySeverity.critical ?? 0}</td><td>${bySeverity.warning ?? 0}</td><td>${bySeverity.info ?? 0}</td></tr>`;
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

type HealthStatus = 'good' | 'warning' | 'critical';

function latestSeverity(records: readonly TrendSnapshotRecord[]): { critical: number; warning: number; info: number } {
  if (records.length === 0) return { critical: 0, warning: 0, info: 0 };
  const payload = JSON.parse(records[0].payload) as { countBySeverity?: Record<string, number> };
  const { critical = 0, warning = 0, info = 0 } = payload.countBySeverity ?? {};
  return { critical, warning, info };
}

/** Shared by `dead-resources`/`resource-security` — both carry the same severity shape. */
function severityHealth(sev: { critical: number; warning: number }): HealthStatus {
  if (sev.critical > 0) return 'critical';
  if (sev.warning > 0) return 'warning';
  return 'good';
}

/**
 * No "critical" tier for cost — there's no honest threshold for what counts
 * as a catastrophic dollar figure, unlike security findings which already
 * carry their own severity. Direction of the trend is the only thing this
 * can say without inventing a cutoff.
 */
function costTrendHealth(records: readonly TrendSnapshotRecord[]): HealthStatus {
  if (records.length < 2) return 'good';
  const comparison = compareCloudCostSnapshots(JSON.parse(records[records.length - 1].payload) as WasteReportDto, JSON.parse(records[0].payload) as WasteReportDto);
  return comparison.deltaUsd > 0 ? 'warning' : 'good';
}

/**
 * A small color dot, never the sole carrier of the status — every call site
 * pairs it with a `title` tooltip and, in the surrounding card/tile, actual
 * text (severity counts, trend direction) that says the same thing in words.
 */
function healthDot(status: HealthStatus, label: string): string {
  return `<span class="viz-health-dot viz-health-${status}" title="${escapeHtml(label)}"></span>`;
}

/**
 * A business-language read of the latest severity breakdown — deliberately
 * no dollar figure. Unlike `cloud-cost`, there is no honest way to price a
 * security finding (no real market cost the way AWS list prices exist for
 * waste), so this stays qualitative rather than inventing a "risk exposure
 * in $" number, consistent with every other "honest caveat" in this project.
 */
function buildSecurityRiskNarrative(records: readonly TrendSnapshotRecord[]): string {
  if (records.length === 0) return '';
  const { critical, warning, info } = latestSeverity(records);
  const total = critical + warning + info;
  if (total === 0) return '<p class="viz-summary viz-risk-narrative">No open security-posture findings on the latest run.</p>';

  const parts = [critical > 0 ? `${critical} critical` : '', warning > 0 ? `${warning} warning` : '', info > 0 ? `${info} info` : ''].filter(Boolean).join(', ');
  const risk =
    critical > 0
      ? 'exposing the account to unauthorized access, data exposure, or compliance violations — address these first'
      : warning > 0
        ? 'worth reviewing before they compound into higher-severity risk'
        : 'low-severity items, no immediate action required';
  return `<p class="viz-summary viz-risk-narrative"><strong>${total}</strong> open finding(s) (${parts}) — ${risk}.</p>`;
}

/**
 * "Where is the money going" for the latest run — turns the headline $ figure
 * into something actionable. Reuses `WasteReportDto.breakdown`, already
 * aggregated and labeled per resource kind (see `toWasteReportDto`), instead
 * of re-deriving totals from `findings` here.
 */
function buildTopWastersList(records: readonly TrendSnapshotRecord[]): string {
  if (records.length === 0) return '';
  const payload = JSON.parse(records[0].payload) as { breakdown?: Array<{ label: string; monthlyCostUsd: number; category: string }> };
  const wasters = (payload.breakdown ?? [])
    .filter((b) => b.category === 'waste' && b.monthlyCostUsd > 0)
    .sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd)
    .slice(0, 3);
  if (wasters.length === 0) return '';

  const items = wasters
    .map((b) => `<li><span class="viz-top-waster-label">${escapeHtml(b.label)}</span><span class="viz-top-waster-value">$${b.monthlyCostUsd.toFixed(2)}/mo</span></li>`)
    .join('');
  return `<div class="viz-top-wasters"><p class="viz-top-wasters-title">Top resource types by waste (latest run)</p><ul class="viz-top-wasters-list">${items}</ul></div>`;
}

/**
 * One domain's chart + summary + table, as a standalone `<div class="viz-card">`.
 * Points are embedded as a sibling `application/json` script tag (not a JS
 * variable) so the page-level script below can support any number of these
 * cards on one page via `querySelectorAll` instead of a single global chart.
 */
function buildDomainSection(records: readonly TrendSnapshotRecord[], domain: TrendDomain): string {
  const isCost = domain === 'cloud-cost';
  const points = isCost ? extractPoints(records) : extractSeverityPoints(records);
  const forecastValue = isCost ? computeForecast(points as DataPoint[]) : undefined;
  const chartSvg = points.length === 0 ? '' : isCost ? buildChartSvg(points as DataPoint[], 'Monthly waste (USD)', '$', forecastValue) : buildSeverityChartSvg(points as SeverityPoint[]);
  const tableRows = buildTableRows(records, domain);
  const riskNarrative = domain === 'resource-security' ? buildSecurityRiskNarrative(records) : '';
  const summary = buildSummary(records, domain);
  const forecastCaveat =
    forecastValue !== undefined
      ? `<p class="viz-summary viz-forecast-caveat">Projected next run: <strong>$${forecastValue.toFixed(2)}</strong> — a straight-line trend estimate from the runs shown, not a guarantee.</p>`
      : '';
  const topWasters = isCost ? buildTopWastersList(records) : '';
  const pointsJson = JSON.stringify(points).replace(/</g, '\\u003c');
  const tableHeader = isCost
    ? '<tr><th>Date</th><th>Domain</th><th>Findings</th><th>Monthly waste</th></tr>'
    : '<tr><th>Date</th><th>Domain</th><th>Critical</th><th>Warning</th><th>Info</th></tr>';

  let health: HealthStatus;
  let healthTitle: string;
  if (isCost) {
    health = costTrendHealth(records);
    healthTitle = health === 'warning' ? 'Waste trending up' : 'Waste stable or trending down';
  } else {
    const sev = latestSeverity(records);
    health = severityHealth(sev);
    healthTitle = health === 'critical' ? `${sev.critical} critical finding(s)` : health === 'warning' ? `${sev.warning} warning finding(s)` : 'No critical/warning findings';
  }

  return `
  <div class="viz-card">
    <h2>${healthDot(health, healthTitle)}${escapeHtml(domain)} — local scan history</h2>
    <p class="viz-subtitle">${records.length} run(s) on record</p>
    ${riskNarrative}
    ${summary}
    <div class="viz-chart-wrap" data-value-prefix="${isCost ? '$' : ''}" ${isCost ? '' : 'data-series="critical,warning,info"'}>
      ${chartSvg}
      <script type="application/json" class="viz-points">${pointsJson}</script>
      <div class="viz-tooltip"><div class="viz-tooltip-date"></div><div class="viz-tooltip-value"></div></div>
    </div>
    ${forecastCaveat}
    ${topWasters}
    <table class="viz-table">
      <thead>${tableHeader}</thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`;
}

function statTile(label: string, value: string, sub: string, health: HealthStatus, healthTitle: string): string {
  return `<div class="viz-stat-tile"><div class="viz-stat-label">${healthDot(health, healthTitle)}${escapeHtml(label)}</div><div class="viz-stat-value">${value}</div><div class="viz-stat-sub">${sub}</div></div>`;
}

function buildCostStatTile(records: readonly TrendSnapshotRecord[]): string {
  const health = costTrendHealth(records);
  const healthTitle = health === 'warning' ? 'Waste trending up' : 'Waste stable or trending down';
  if (records.length === 0) return statTile('Monthly Waste', '—', 'No scans yet', health, healthTitle);
  const latest = JSON.parse(records[0].payload) as { totalWasteMonthlyUsd?: number };
  const value = `$${(latest.totalWasteMonthlyUsd ?? 0).toFixed(2)}`;
  if (records.length < 2) return statTile('Monthly Waste', value, 'No earlier run to compare', health, healthTitle);

  const comparison = compareCloudCostSnapshots(JSON.parse(records[records.length - 1].payload) as WasteReportDto, JSON.parse(records[0].payload) as WasteReportDto);
  const deltaClass = comparison.deltaUsd > 0 ? 'viz-delta-bad' : comparison.deltaUsd < 0 ? 'viz-delta-good' : '';
  const arrow = comparison.deltaUsd > 0 ? '▲' : comparison.deltaUsd < 0 ? '▼' : '—';
  return statTile('Monthly Waste', value, `<span class="${deltaClass}">${arrow} $${Math.abs(comparison.deltaUsd).toFixed(2)} vs earliest run shown</span>`, health, healthTitle);
}

/** No dollar figure here either — see `buildSecurityRiskNarrative` for why. */
function buildSecurityStatTile(records: readonly TrendSnapshotRecord[]): string {
  const sev = latestSeverity(records);
  const health = severityHealth(sev);
  const healthTitle = health === 'critical' ? `${sev.critical} critical finding(s)` : health === 'warning' ? `${sev.warning} warning finding(s)` : 'No critical/warning findings';
  if (records.length === 0) return statTile('Security Risk', '—', 'No scans yet', health, healthTitle);
  const value = sev.critical > 0 ? `${sev.critical} critical` : sev.warning > 0 ? `${sev.warning} warning` : 'Clear';
  const sub =
    sev.critical > 0
      ? '<span class="viz-delta-bad">Unauthorized-access / compliance exposure</span>'
      : sev.warning > 0
        ? 'Review before it compounds'
        : 'No open findings';
  return statTile('Security Risk', value, sub, health, healthTitle);
}

function buildDeadResourcesStatTile(records: readonly TrendSnapshotRecord[]): string {
  const sev = latestSeverity(records);
  const health = severityHealth(sev);
  const healthTitle = health === 'critical' ? `${sev.critical} critical finding(s)` : health === 'warning' ? `${sev.warning} warning finding(s)` : 'No critical/warning findings';
  if (records.length === 0) return statTile('Dead Resources', '—', 'No scans yet', health, healthTitle);
  const total = sev.critical + sev.warning + sev.info;
  if (records.length < 2) return statTile('Dead Resources', `${total}`, 'No earlier run to compare', health, healthTitle);

  const comparison = compareHygieneSnapshots(
    'dead-resources',
    JSON.parse(records[records.length - 1].payload) as DeadResourcesReportDto,
    JSON.parse(records[0].payload) as DeadResourcesReportDto,
  );
  return statTile('Dead Resources', `${total}`, `${comparison.resolvedFindings.length} resolved, ${comparison.newFindings.length} new since earliest run shown`, health, healthTitle);
}

/**
 * Cross-domain headline row for the combined report only (see
 * `generateCombinedHistoryReportHtml`) — a single-domain report already has
 * its one chart as the whole story, so this would just repeat it.
 */
function buildExecutiveSummary(recordsByDomain: Readonly<Record<TrendDomain, readonly TrendSnapshotRecord[]>>): string {
  const tiles = [
    buildCostStatTile(recordsByDomain['cloud-cost']),
    buildSecurityStatTile(recordsByDomain['resource-security']),
    buildDeadResourcesStatTile(recordsByDomain['dead-resources']),
  ].join('');
  return `<div class="viz-exec-summary">${tiles}</div>`;
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
    /* Status palette — fixed, never themed: same hex in light and dark. */
    --severity-critical: #d03b3b;
    --severity-warning: #fab219;
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
  .viz-forecast-caveat, .viz-risk-narrative { font-size: 12px; font-style: italic; }
  .viz-top-wasters { margin: 12px 0 0; }
  .viz-top-wasters-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 6px; }
  .viz-top-wasters-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .viz-top-wasters-list li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 5px 0; border-bottom: 1px solid var(--gridline); }
  .viz-top-waster-value { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .viz-health-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .viz-health-good { background: var(--good); }
  .viz-health-warning { background: var(--severity-warning); }
  .viz-health-critical { background: var(--severity-critical); }
  .viz-exec-summary { display: flex; gap: 16px; margin: 0 0 24px; }
  .viz-stat-tile { flex: 1; background: var(--surface-1); border-radius: 8px; padding: 16px 20px; }
  .viz-stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .viz-stat-value { font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
  .viz-stat-sub { font-size: 12px; color: var(--text-secondary); }
  .viz-svg { width: 100%; height: auto; overflow: visible; }
  .viz-gridline { stroke: var(--gridline); stroke-width: 1; }
  .viz-line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .viz-area { fill: var(--series-1); opacity: 0.1; stroke: none; }
  .viz-dot { fill: var(--series-1); stroke: var(--surface-1); stroke-width: 2; }
  .viz-end-label { fill: var(--text-primary); font-size: 13px; font-weight: 600; }
  .viz-forecast-line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-dasharray: 5 4; opacity: 0.55; }
  .viz-forecast-dot { fill: var(--surface-1); stroke: var(--series-1); stroke-width: 2; opacity: 0.8; }
  .viz-forecast-label { fill: var(--text-secondary); font-size: 11px; font-style: italic; }
  .viz-line-critical, .viz-line-warning, .viz-line-info { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .viz-line-critical { stroke: var(--severity-critical); }
  .viz-line-warning { stroke: var(--severity-warning); }
  .viz-line-info { stroke: var(--text-muted); }
  .viz-dot-critical, .viz-dot-warning, .viz-dot-info { stroke: var(--surface-1); stroke-width: 2; }
  .viz-dot-critical { fill: var(--severity-critical); }
  .viz-dot-warning { fill: var(--severity-warning); }
  .viz-dot-info { fill: var(--text-muted); }
  .viz-end-label-critical, .viz-end-label-warning, .viz-end-label-info { font-size: 12px; font-weight: 600; }
  .viz-end-label-critical { fill: var(--severity-critical); }
  .viz-end-label-warning { fill: var(--severity-warning); }
  .viz-end-label-info { fill: var(--text-muted); }
  .viz-legend { display: flex; gap: 16px; margin-bottom: 8px; font-size: 12px; color: var(--text-secondary); }
  .viz-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .viz-legend-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .viz-legend-swatch-critical { background: var(--severity-critical); }
  .viz-legend-swatch-warning { background: var(--severity-warning); }
  .viz-legend-swatch-info { background: var(--text-muted); }
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
  .viz-tooltip-row { display: block; }
  .viz-tooltip-row-critical { color: var(--severity-critical); }
  .viz-tooltip-row-warning { color: var(--severity-warning); }
  .viz-tooltip-row-info { color: var(--text-muted); }
  table.viz-table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 13px; }
  table.viz-table th, table.viz-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--gridline); }
  table.viz-table th { color: var(--text-muted); font-weight: 600; }
  table.viz-table td:nth-child(3), table.viz-table td:nth-child(4), table.viz-table td:nth-child(5) { font-variant-numeric: tabular-nums; }
  .viz-chart-wrap { position: relative; }`;

/**
 * Wires up every `.viz-chart-wrap` on the page independently (one page can
 * hold one card or several stacked ones — see `generateCombinedHistoryReportHtml`),
 * reading each chart's own points from its sibling `application/json` script
 * instead of a single page-wide variable. `data-series` (present only on the
 * severity charts) switches the tooltip from a single value to one row per
 * series — dots for each series share the same x position per index, so the
 * first series' dots alone drive nearest-point lookup. The forecast slot (if
 * any) is a static direct-labeled point, not part of `points` — never
 * hoverable, since it isn't a real snapshot.
 */
const PAGE_SCRIPT = `
    (function () {
      document.querySelectorAll('.viz-chart-wrap').forEach(function (wrap) {
        var svg = wrap.querySelector('.viz-svg');
        var pointsTag = wrap.querySelector('.viz-points');
        var points = pointsTag ? JSON.parse(pointsTag.textContent) : [];
        if (!svg || points.length === 0) return;
        var seriesAttr = wrap.getAttribute('data-series');
        var seriesKeys = seriesAttr ? seriesAttr.split(',') : ['value'];
        var crosshair = svg.querySelector('.viz-crosshair');
        var tooltip = wrap.querySelector('.viz-tooltip');
        var dateEl = tooltip.querySelector('.viz-tooltip-date');
        var valueEl = tooltip.querySelector('.viz-tooltip-value');
        var firstSeriesDotClass = seriesAttr ? '.viz-dot-' + seriesKeys[0] : '.viz-dot';
        var dots = Array.prototype.slice.call(svg.querySelectorAll(firstSeriesDotClass));
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
          if (seriesAttr) {
            valueEl.innerHTML = seriesKeys.map(function (key) {
              var label = key.charAt(0).toUpperCase() + key.slice(1);
              return '<span class="viz-tooltip-row viz-tooltip-row-' + key + '">' + label + ': ' + point[key].toLocaleString() + '</span>';
            }).join('');
          } else {
            valueEl.textContent = valuePrefix + point.value.toLocaleString();
          }
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
 * Self-contained HTML report for one domain's trend history: a line chart
 * (inline SVG, zero chart-library dependency) — a single series for
 * `cloud-cost` (monthly waste, with a linear projection past the last real
 * run), three for `dead-resources`/`resource-security` (critical/warning/
 * info) — plus its table-view twin, per the project's dataviz conventions:
 * hand-rolled SVG over a bundled charting library or a CDN script,
 * consistent with why `pdfkit` was chosen over a headless browser (no heavy
 * dependency, fully offline, nothing ever leaves the machine).
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
 * Leads with a 3-tile executive summary (monthly waste + delta, security
 * risk, dead-resources trend) aimed at a CTO/CEO audience who wants the
 * headline before scrolling into any one domain's detail.
 */
export function generateCombinedHistoryReportHtml(recordsByDomain: Readonly<Record<TrendDomain, readonly TrendSnapshotRecord[]>>, accountId: string): string {
  const domains: TrendDomain[] = ['cloud-cost', 'dead-resources', 'resource-security'];
  const title = 'cloudrift — scan history';
  const subtitle = `Account ${escapeHtml(accountId)} · generated locally, never uploaded anywhere`;
  const execSummary = buildExecutiveSummary(recordsByDomain);
  const sections = domains.map((domain) => buildDomainSection(recordsByDomain[domain], domain)).join('\n');
  return buildPage(title, subtitle, execSummary + sections);
}
