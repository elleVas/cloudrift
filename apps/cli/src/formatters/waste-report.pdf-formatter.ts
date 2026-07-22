// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'fs';
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_META,
  groupByKind,
} from 'cloud-cost-domain';
import type {
  FindingCategory,
  WastedResource,
  WastedResourcesSummary,
} from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { REPORT_DISCLAIMER } from 'cloud-cost-application';
import { presenterFor, rowFor, recommendFor } from './resource-presenters';
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

  // Divider
  y += 18;
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
        `Savings without deleting the resource — $${summary.totalOptimizationMonthlyUsd.toFixed(2)}/mo, not counted in the waste total. Items marked (estimated) need verification.`,
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
      .text('Top recommendations — sorted by monthly impact', MARGIN, y, { lineBreak: false });
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
    const rows = findings.map((finding) => [
      ...rowFor(finding),
      `$${finding.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    const headers = [...presenter.head, 'Cost/mo'];
    const colWidths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    drawTable(doc, headers, rows, colWidths, y, contentBottom);
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
}

function buildQuickWins(summary: WastedResourcesSummary): QuickWin[] {
  // Routed through groupByKind (not summary.findings directly) so `finding`
  // keeps the kind↔entity correlation recommendFor's switch relies on.
  const grouped = groupByKind(summary.findings);
  const wins: QuickWin[] = [];
  for (const kind of RESOURCE_KINDS) {
    for (const finding of grouped[kind]) {
      wins.push({ label: recommendFor(finding), monthlyCostUsd: finding.costEstimate.monthlyCostUsd });
    }
  }
  return wins.sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd).slice(0, 8);
}

// Fixed overhead around the label column: 22 (index area) + 74 (gap, monthly
// cost width and its own gap, all folded into the annual column's x-offset)
// + 40 (annual cost width) + 8 (right padding, so "/yr" doesn't sit flush
// against the table border) = 144. labelW must leave exactly this much room.
const RECOMMENDATION_FIXED_W = 144;

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

    const { monthlyCostUsd } = wins[i];
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

    // Monthly cost
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.danger)
      .text(`$${monthlyCostUsd.toFixed(2)}/mo`, MARGIN + 22 + labelW + 4, y + 6, { width: 66, align: 'right', lineBreak: false });

    // Annual cost
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(`$${annual.toFixed(0)}/yr`, MARGIN + 22 + labelW + 74, y + 6, { width: 40, align: 'right', lineBreak: false });

    y += h;
    segmentH += h;
  }

  strokeSegmentBorder();
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
      const estimatedSuffix = RESOURCE_KIND_META[kind].estimated ? ' (estimated)' : '';
      return [
        `${RESOURCE_KIND_LABELS[kind]} (${findings[0].wasteReason})${estimatedSuffix}`,
        String(findings.length),
        `$${cost.toFixed(2)}/mo`,
      ];
    });
}
