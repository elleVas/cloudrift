// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'fs';
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_META,
  groupByKind,
  confidenceOf,
} from 'cloud-cost-domain';
import type {
  FindingCategory,
  RemediationEffort,
  WastedResource,
  WastedResourcesSummary,
} from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { REPORT_DISCLAIMER, isPricesStale, PRICES_STALE_AFTER_DAYS } from 'cloud-cost-application';
import { presenterFor, rowFor, recommendFor } from './resource-presenters';
import { buildConsoleUrl } from '../aws-console-link';
import {
  C,
  PAGE_H,
  MARGIN,
  CONTENT_W,
  LINE_H,
  drawMasthead,
  ensureSpace,
  measureDisclaimerHeight,
  footerReservedHeight,
  drawFooter,
  drawMetricBox,
  measureTableHeight,
  drawTable,
  computeColumnWidths,
  wrapToLines,
  rowHeightForLines,
} from './pdf-shared';

export async function generateWasteReportPdf(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
  outputPath: string,
): Promise<void> {
  // Lazy-loaded (same pattern as @clack/prompts in the wizard): pdfkit's own
  // font loading/registration only pays off for the ~1% of runs that pass
  // --pdf, not every invocation.
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const disclaimerH = measureDisclaimerHeight(doc, REPORT_DISCLAIMER);
    const contentBottom = PAGE_H - MARGIN - footerReservedHeight(disclaimerH);

    // Every page (the first one included, since autoFirstPage is off) gets
    // its footer drawn here, right when it's created — see drawFooter above.
    doc.on('pageAdded', () => drawFooter(doc, REPORT_DISCLAIMER, disclaimerH));
    doc.addPage();

    drawSummaryPage(doc, summary, meta, contentBottom);
    drawDetailPages(doc, summary, contentBottom);

    doc.end();
  });
}

// ─── Summary page ────────────────────────────────────────────────────────────

function drawSummaryPage(
  doc: PDFKit.PDFDocument,
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
  contentBottom: number,
): void {
  const bandH = drawMasthead(doc, 'cloudrift', 'AWS Waste Detection Report');
  let y = bandH + 24;

  // Metadata
  const metaParts: string[] = [
    `Generated: ${meta.generatedAt.toISOString().split('T')[0]}`,
  ];
  if (meta.accountId !== 'unknown') metaParts.push(`Account: ${meta.accountId}`);
  metaParts.push(`Regions: ${meta.regions.join(', ')}`);
  metaParts.push(`Prices as of: ${meta.pricesAsOf}`);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
    .text(metaParts.join('   ·   '), MARGIN, y, { lineBreak: false });
  y += 12;

  if (isPricesStale(meta.pricesAsOf, meta.generatedAt)) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.warning)
      .text(
        `⚠ Price list is over ${PRICES_STALE_AFTER_DAYS} days old — consider running with --live-pricing for fresher estimates.`,
        MARGIN,
        y,
        { lineBreak: false },
      );
    y += 12;
  }

  // Divider
  y += 6;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).strokeColor(C.border).stroke();

  // Metric boxes
  y += 14;
  const monthly = summary.totalWasteMonthlyUsd;
  const annual = monthly * 12;
  const total = summary.findings.length;
  const isIncomplete = summary.scanErrors.length > 0;

  const monthlyLabel = isIncomplete ? `$${monthly.toFixed(2)}/mo *` : `$${monthly.toFixed(2)}/mo`;
  const annualLabel = isIncomplete ? `$${annual.toFixed(2)}/yr *` : `$${annual.toFixed(2)}/yr`;

  y = ensureSpace(doc, y, 90, contentBottom);
  drawMetricBox(doc, MARGIN, y, 152, 'MONTHLY WASTE', monthlyLabel, C.danger);
  drawMetricBox(doc, MARGIN + 162, y, 152, 'ANNUAL WASTE', annualLabel, C.warning);
  drawMetricBox(doc, MARGIN + 324, y, 123, 'RESOURCES FOUND', String(total), C.text);

  // Waste breakdown — measured up front so the whole table moves to a fresh
  // page instead of splitting awkwardly mid-table when it doesn't fit here.
  y += 90;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
    .text('Waste breakdown by resource type', MARGIN, y, { lineBreak: false });
  y += 16;

  // Bar chart first (skim-in-5-seconds view of the biggest offenders), exact
  // per-kind numbers in the table right below — additive, not a replacement,
  // so nothing present today is lost.
  const chartRows = buildCategoryChartRows(summary, 'waste');
  if (chartRows.length > 0) {
    y = ensureSpace(doc, y, measureBarChartHeight(doc, chartRows), contentBottom);
    y = drawBarChart(doc, chartRows, y);
    y += 14;
  }

  const breakdownRows = buildBreakdownRows(summary, 'waste');
  const breakdownHeaders = ['Resource type', 'Found', 'Est. cost/month'];
  const breakdownColWidths = computeColumnWidths(doc, breakdownHeaders, breakdownRows, CONTENT_W);
  y = ensureSpace(doc, y, measureTableHeight(doc, breakdownHeaders, breakdownRows, breakdownColWidths), contentBottom);
  y = drawTable(doc, breakdownHeaders, breakdownRows, breakdownColWidths, y, contentBottom);

  // Optimization opportunities (separate — not counted in the waste total)
  const optimizationRows = buildBreakdownRows(summary, 'optimization');
  if (optimizationRows.length > 0) {
    y += 20;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
      .text('Optimization opportunities', MARGIN, y, { lineBreak: false });
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(
        `Savings without deleting the resource — $${summary.totalOptimizationMonthlyUsd.toFixed(2)}/mo derived from real price differences (rightsizing, gp2→gp3, ...), not counted in the waste total above and not a blind percentage. Items marked (derived) still need verification before acting; items marked (no $ estimate) are namespace-hygiene flags with no real dollar basis to report.`,
        MARGIN, y, { width: CONTENT_W },
      );
    y += 18;
    const optimizationHeaders = ['Resource type', 'Found', 'Est. saving/month'];
    const optimizationColWidths = computeColumnWidths(doc, optimizationHeaders, optimizationRows, CONTENT_W);
    y = ensureSpace(doc, y, measureTableHeight(doc, optimizationHeaders, optimizationRows, optimizationColWidths), contentBottom);
    y = drawTable(doc, optimizationHeaders, optimizationRows, optimizationColWidths, y, contentBottom);
  }

  // Recommendations
  const wins = buildQuickWins(summary);
  if (wins.length > 0) {
    y += 20;
    y = ensureSpace(doc, y, 16 + measureRecommendationsHeight(doc, wins), contentBottom);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
      .text('Top quick wins — savings vs. remediation effort', MARGIN, y, { lineBreak: false });
    y += 16;
    y = drawRecommendations(doc, wins, y, contentBottom);
  }

  // Warnings — each message is measured and advanced by its actual wrapped
  // height; a fixed per-line increment here previously made long warnings
  // (e.g. LocalStack's multi-line error text) overlap the next one.
  if (summary.scanErrors.length > 0) {
    y += 16;
    y = ensureSpace(doc, y, 14, contentBottom);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.warning)
      .text('* Scan warnings — partial results:', MARGIN, y, { lineBreak: false });
    y += 14;
    for (const { kind, region, error } of summary.scanErrors) {
      const text = `• ${RESOURCE_KIND_LABELS[kind]} in ${region}: ${error.message}`;
      doc.font('Helvetica').fontSize(8.5);
      const lineH = doc.heightOfString(text, { width: CONTENT_W - 8 });
      y = ensureSpace(doc, y, lineH + 4, contentBottom);
      doc.fillColor(C.warning).text(text, MARGIN + 8, y, { width: CONTENT_W - 8 });
      y += lineH + 4;
    }
  }
}

// ─── Detail pages ─────────────────────────────────────────────────────────────

function drawDetailPages(
  doc: PDFKit.PDFDocument,
  summary: WastedResourcesSummary,
  contentBottom: number,
): void {
  const grouped = groupByKind(summary.findings);

  for (const kind of RESOURCE_KINDS) {
    const findings = grouped[kind];
    if (findings.length === 0) continue;

    const presenter = presenterFor(kind);
    doc.addPage();
    const y = sectionHeader(doc, presenter.title);
    const links = findings.map((finding) =>
      buildConsoleUrl({ kind: finding.kind, id: finding.id, region: finding.region.code }),
    );
    const rows = findings.map((finding) => [
      ...rowFor(finding),
      `$${finding.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
      '',
    ]);
    const headers = [...presenter.head, 'Cost/mo', 'Link'];
    const colWidths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    drawTable(doc, headers, rows, colWidths, y, contentBottom, links);
  }
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): number {
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.primary)
    .text(title, MARGIN, MARGIN, { lineBreak: false });
  return MARGIN + 26;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

interface QuickWin {
  label: string;
  monthlyCostUsd: number;
  effort: RemediationEffort;
}

// Divides the $ impact down by how much work remediating it takes (ADR-0093,
// docs/en/remediation-effort.md), so a cheap-to-fix medium finding can outrank
// an expensive one that needs a maintenance window — "quick wins" means both
// savings AND effort, not just the biggest dollar figure.
const EFFORT_WEIGHT: Record<RemediationEffort, number> = { low: 1, medium: 2, high: 3 };

function buildQuickWins(summary: WastedResourcesSummary): QuickWin[] {
  // Routed through groupByKind (not summary.findings directly) so `finding`
  // keeps the kind↔entity correlation recommendFor's switch relies on.
  const grouped = groupByKind(summary.findings);
  const wins: QuickWin[] = [];
  for (const kind of RESOURCE_KINDS) {
    const { effort } = RESOURCE_KIND_META[kind];
    for (const finding of grouped[kind]) {
      wins.push({ label: recommendFor(finding), monthlyCostUsd: finding.costEstimate.monthlyCostUsd, effort });
    }
  }
  return wins
    .sort((a, b) => b.monthlyCostUsd / EFFORT_WEIGHT[b.effort] - a.monthlyCostUsd / EFFORT_WEIGHT[a.effort])
    .slice(0, 8);
}

const EFFORT_BADGE_COLOR: Record<RemediationEffort, string> = { low: C.success, medium: C.warning, high: C.danger };
const EFFORT_BADGE_LABEL: Record<RemediationEffort, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' };
const EFFORT_BADGE_W = 32;

// Fixed overhead around the label column: 22 (index area) + 4 (gap) + 32
// (effort badge) + 74 (gap, monthly cost width and its own gap, all folded
// into the annual column's x-offset) + 40 (annual cost width) + 8 (right
// padding, so "/yr" doesn't sit flush against the table border) = 180.
// labelW must leave exactly this much room.
const RECOMMENDATION_FIXED_W = 180;

function recommendationLabelWidth(): number {
  return CONTENT_W - RECOMMENDATION_FIXED_W;
}

/** Total height the recommendations block would need in one piece — same
 * "measure before drawing" idea as measureTableHeight, for the keep-together
 * page break below. */
function measureRecommendationsHeight(doc: PDFKit.PDFDocument, wins: QuickWin[]): number {
  doc.font('Helvetica').fontSize(8.5);
  const labelW = recommendationLabelWidth();
  return wins.reduce(
    (total, { label }) => total + rowHeightForLines(wrapToLines(doc, label, labelW).length),
    0,
  );
}

function drawRecommendations(
  doc: PDFKit.PDFDocument,
  wins: QuickWin[],
  startY: number,
  contentBottom: number,
): number {
  let y = startY;
  let segmentStartY = startY;
  let segmentH = 0;
  const labelW = recommendationLabelWidth();

  const strokeSegmentBorder = () => {
    if (segmentH === 0) return;
    doc.rect(MARGIN, segmentStartY, CONTENT_W, segmentH)
      .lineWidth(0.5).strokeColor(C.border).stroke();
  };

  for (let i = 0; i < wins.length; i++) {
    doc.font('Helvetica').fontSize(8.5);
    const labelLines = wrapToLines(doc, wins[i].label, labelW);
    const h = rowHeightForLines(labelLines.length);

    if (y + h > contentBottom) {
      strokeSegmentBorder();
      doc.addPage();
      y = MARGIN;
      segmentStartY = y;
      segmentH = 0;
    }

    const { monthlyCostUsd, effort } = wins[i];
    const annual = monthlyCostUsd * 12;
    const bg = i % 2 === 0 ? '#ffffff' : C.rowAlt;

    doc.rect(MARGIN, y, CONTENT_W, h).fill(bg);

    // Index
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted)
      .text(`${i + 1}.`, MARGIN + 4, y + 6, { width: 16, lineBreak: false });

    // Label — wrapped above, uncapped, so it never loses text to an ellipsis.
    doc.font('Helvetica').fontSize(8.5).fillColor(C.text);
    labelLines.forEach((line, li) => {
      doc.text(line, MARGIN + 22, y + 6 + li * LINE_H, { width: labelW, lineBreak: false });
    });

    // Effort badge
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(EFFORT_BADGE_COLOR[effort])
      .text(EFFORT_BADGE_LABEL[effort], MARGIN + 22 + labelW + 4, y + 6.5, { width: EFFORT_BADGE_W, align: 'right', lineBreak: false });

    // Monthly cost
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.danger)
      .text(`$${monthlyCostUsd.toFixed(2)}/mo`, MARGIN + 22 + labelW + 40, y + 6, { width: 66, align: 'right', lineBreak: false });

    // Annual cost
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(`$${annual.toFixed(0)}/yr`, MARGIN + 22 + labelW + 110, y + 6, { width: 40, align: 'right', lineBreak: false });

    y += h;
    segmentH += h;
  }

  strokeSegmentBorder();
  return y;
}

// ─── Category bar chart ───────────────────────────────────────────────────────

interface BarChartRow {
  label: string;
  monthlyCostUsd: number;
}

const BAR_CHART_LABEL_W = 190;
const BAR_CHART_VALUE_W = 64;
const BAR_CHART_MAX_ROWS = 6;
const BAR_CHART_BAR_H = 8;
const BAR_CHART_ROW_MIN_H = 16;

/** Top N resource kinds by monthly cost within a category — capped so the
 * chart stays a skimmable "biggest offenders" view; the exact table right
 * below it still lists every kind found, capped or not. */
function buildCategoryChartRows(summary: WastedResourcesSummary, category: FindingCategory): BarChartRow[] {
  const grouped = groupByKind(summary.findings);
  return RESOURCE_KINDS
    .filter((kind) => RESOURCE_KIND_META[kind].category === category && grouped[kind].length > 0)
    .map((kind) => ({
      label: RESOURCE_KIND_LABELS[kind],
      monthlyCostUsd: grouped[kind].reduce((sum, f) => sum + f.costEstimate.monthlyCostUsd, 0),
    }))
    .sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd)
    .slice(0, BAR_CHART_MAX_ROWS);
}

function measureBarChartHeight(doc: PDFKit.PDFDocument, rows: BarChartRow[]): number {
  doc.font('Helvetica').fontSize(8);
  return rows.reduce(
    (total, row) => total + Math.max(rowHeightForLines(wrapToLines(doc, row.label, BAR_CHART_LABEL_W).length), BAR_CHART_ROW_MIN_H),
    0,
  );
}

function drawBarChart(doc: PDFKit.PDFDocument, rows: BarChartRow[], startY: number): number {
  let y = startY;
  const barAreaX = MARGIN + BAR_CHART_LABEL_W + 8;
  const barAreaW = CONTENT_W - BAR_CHART_LABEL_W - 8 - BAR_CHART_VALUE_W - 8;
  const maxCost = Math.max(...rows.map((r) => r.monthlyCostUsd), 0.01);

  for (const row of rows) {
    doc.font('Helvetica').fontSize(8);
    const labelLines = wrapToLines(doc, row.label, BAR_CHART_LABEL_W);
    const rowH = Math.max(rowHeightForLines(labelLines.length), BAR_CHART_ROW_MIN_H);

    doc.fillColor(C.text);
    labelLines.forEach((line, li) => {
      doc.text(line, MARGIN, y + li * LINE_H, { width: BAR_CHART_LABEL_W, lineBreak: false });
    });

    const barW = Math.max((row.monthlyCostUsd / maxCost) * barAreaW, 2);
    doc.rect(barAreaX, y + (rowH - BAR_CHART_BAR_H) / 2, barW, BAR_CHART_BAR_H).fill(C.primary);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text).text(
      `$${row.monthlyCostUsd.toFixed(2)}/mo`,
      barAreaX + barAreaW + 8,
      y + (rowH - LINE_H) / 2,
      { width: BAR_CHART_VALUE_W, align: 'right', lineBreak: false },
    );

    y += rowH;
  }
  return y;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBreakdownRows(
  summary: WastedResourcesSummary,
  category: FindingCategory,
): string[][] {
  const grouped = groupByKind(summary.findings);

  return RESOURCE_KINDS
    .filter((kind) => RESOURCE_KIND_META[kind].category === category && grouped[kind].length > 0)
    .map((kind) => {
      const findings: WastedResource[] = grouped[kind];
      const cost = findings.reduce((sum, f) => sum + f.costEstimate.monthlyCostUsd, 0);
      const confidence = confidenceOf(kind);
      // measured (all 'waste' kinds): no suffix, same as before. derived:
      // a real price difference, still needs verifying. heuristic: always
      // $0 by construction (see entity docs) — say so instead of showing a
      // misleadingly-precise "$0.00/mo".
      const suffix = confidence === 'derived' ? ' (derived)' : confidence === 'heuristic' ? ' (no $ estimate)' : '';
      const costCell = confidence === 'heuristic' ? 'no $ basis' : `$${cost.toFixed(2)}/mo`;
      return [
        `${RESOURCE_KIND_LABELS[kind]} (${findings[0].wasteReason})${suffix}`,
        String(findings.length),
        costCell,
      ];
    });
}
