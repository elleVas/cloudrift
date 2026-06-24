import PDFDocument from 'pdfkit';
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
import { REPORT_CONTACT, REPORT_DISCLAIMER } from 'cloud-cost-application';
import { presenterFor } from './resource-presenters';

const C = {
  primary: '#1d4ed8',
  danger: '#dc2626',
  warning: '#d97706',
  text: '#111827',
  muted: '#6b7280',
  tableHeader: '#f3f4f6',
  rowAlt: '#f9fafb',
  border: '#d1d5db',
  // Masthead band — Ayu Dark, matching the CLI banner's palette.
  bannerBg: '#0b0e14',
  bannerTitle: '#f2f0ea',
  bannerSubtitle: '#8a93a6',
  bannerAccent: '#53bdfa',
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ROW_H = 20;
const LINE_H = 11;
const MAX_CELL_LINES = 2;

/** A row's height grows past ROW_H only when one of its cells actually wraps. */
function rowHeightForLines(lineCount: number): number {
  return lineCount <= 1 ? ROW_H : lineCount * LINE_H + 8;
}

// Footer layout constants (gap above the divider, then divider → disclaimer →
// contact line), used both to reserve bottom space on every page and to draw it.
const FOOTER_GAP = 18;
const FOOTER_TOP_PAD = 10;
const FOOTER_MID_PAD = 6;
const FOOTER_CONTACT_H = 12;

/** Forces a section onto a fresh page when it wouldn't otherwise fit, so
 * fixed-position blocks (which don't self-paginate like drawTable) never
 * straddle a page boundary. `contentBottom` is the page's content limit,
 * already excluding the space reserved for the per-page footer. */
function ensureSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  needed: number,
  contentBottom: number,
): number {
  if (y + needed > contentBottom) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** Disclaimer text height at the footer's font, measured once per document. */
function measureDisclaimerHeight(doc: PDFKit.PDFDocument): number {
  return doc.font('Helvetica').fontSize(7).heightOfString(REPORT_DISCLAIMER, { width: CONTENT_W });
}

/** Draws the disclaimer + contact footer at a fixed position near the bottom
 * of whichever page is currently active — called on every page via 'pageAdded'
 * so it's never orphaned on its own page and never missing from any page. */
function drawFooter(doc: PDFKit.PDFDocument, disclaimerH: number): void {
  let y = PAGE_H - MARGIN - (FOOTER_TOP_PAD + disclaimerH + FOOTER_MID_PAD + FOOTER_CONTACT_H);
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(C.border).stroke();
  y += FOOTER_TOP_PAD;
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
    .text(REPORT_DISCLAIMER, MARGIN, y, { width: CONTENT_W });
  y += disclaimerH + FOOTER_MID_PAD;
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
    .text('Contact: ', MARGIN, y, { continued: true, lineBreak: false })
    .fillColor(C.primary)
    .text(REPORT_CONTACT.email, {
      continued: true,
      link: `mailto:${REPORT_CONTACT.email}`,
      underline: true,
    })
    .fillColor(C.muted)
    .text(' · ', { continued: true, lineBreak: false })
    .fillColor(C.primary)
    .text('GitHub', { continued: true, link: REPORT_CONTACT.github, underline: true })
    .fillColor(C.muted)
    .text(' · ', { continued: true, lineBreak: false })
    .fillColor(C.primary)
    .text('LinkedIn', { link: REPORT_CONTACT.linkedin, underline: true });
}

export function generateWasteReportPdf(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const disclaimerH = measureDisclaimerHeight(doc);
    const contentBottom =
      PAGE_H - MARGIN - (FOOTER_GAP + FOOTER_TOP_PAD + disclaimerH + FOOTER_MID_PAD + FOOTER_CONTACT_H);

    // Every page (the first one included, since autoFirstPage is off) gets
    // its footer drawn here, right when it's created — see drawFooter above.
    doc.on('pageAdded', () => drawFooter(doc, disclaimerH));
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
  // Masthead: a full-bleed dark band (same Ayu Dark palette as the CLI
  // banner) instead of a thin colored wordmark floating on white.
  const bandH = 84;
  doc.rect(0, 0, PAGE_W, bandH).fill(C.bannerBg);
  doc.font('Helvetica-Bold').fontSize(28).fillColor(C.bannerTitle)
    .text('CloudRift', MARGIN, 20, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor(C.bannerSubtitle)
    .text('AWS Waste Detection Report', MARGIN, 54, { lineBreak: false });
  doc.rect(MARGIN, bandH - 6, 56, 3).fill(C.bannerAccent);

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
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(C.border).stroke();

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
  const breakdownColWidths = [290, 60, 149];
  y = ensureSpace(doc, y, measureTableHeight(doc, ['Resource type', 'Found', 'Est. cost/month'], breakdownRows, breakdownColWidths), contentBottom);
  y = drawTable(doc, ['Resource type', 'Found', 'Est. cost/month'], breakdownRows, breakdownColWidths, y, contentBottom);

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
    const optimizationColWidths = [290, 60, 149];
    y = ensureSpace(doc, y, measureTableHeight(doc, ['Resource type', 'Found', 'Est. saving/month'], optimizationRows, optimizationColWidths), contentBottom);
    y = drawTable(doc, ['Resource type', 'Found', 'Est. saving/month'], optimizationRows, optimizationColWidths, y, contentBottom);
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

function drawMetricBox(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number,
  label: string, value: string, valueColor: string,
): void {
  const h = 72;
  doc.rect(x, y, w, h).lineWidth(0.5).fillAndStroke('#fafafa', C.border);
  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
    .text(label, x + 10, y + 11, { width: w - 20, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(18).fillColor(valueColor)
    .text(value, x + 10, y + 26, { width: w - 20, lineBreak: false });
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
    const rows = findings.map((finding: WastedResource) => [
      ...presenter.row(finding),
      `$${finding.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    const scale = CONTENT_W / presenter.colWidths.reduce((a, b) => a + b, 0);
    const colWidths = presenter.colWidths.map((w) => w * scale);
    drawTable(doc, [...presenter.head, 'Cost/mo'], rows, colWidths, y, contentBottom);
  }
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): number {
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.primary)
    .text(title, MARGIN, MARGIN, { lineBreak: false });
  return MARGIN + 26;
}

// ─── Table primitive ──────────────────────────────────────────────────────────

/** Greedy word-wrap up to `maxLines`; anything left over is folded into the
 * last line and ellipsized, so a cell never grows past its line budget. */
function wrapToLines(doc: PDFKit.PDFDocument, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && doc.widthOfString(candidate) > maxW) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines - 1);
  const rest = lines.slice(maxLines - 1).join(' ');
  kept.push(clip(doc, rest, maxW));
  return kept;
}

function clip(doc: PDFKit.PDFDocument, text: string, maxW: number): string {
  if (doc.widthOfString(text) <= maxW) return text;
  let s = text;
  while (s.length > 0 && doc.widthOfString(s + '…') > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** Wraps every cell in a row (up to MAX_CELL_LINES) — font/size must be set
 * BEFORE measuring, since doc.widthOfString() uses whatever font is active. */
function wrapRow(doc: PDFKit.PDFDocument, cells: string[], colWidths: number[], bold: boolean): string[][] {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
  return cells.map((cell, i) => wrapToLines(doc, cell, colWidths[i] - 8, MAX_CELL_LINES));
}

function renderWrappedRow(
  doc: PDFKit.PDFDocument,
  wrapped: string[][],
  colWidths: number[],
  y: number,
  bold: boolean,
): void {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(C.text);
  let x = MARGIN;
  for (let i = 0; i < wrapped.length; i++) {
    const w = colWidths[i];
    wrapped[i].forEach((line, li) => {
      doc.text(line, x + 4, y + 6 + li * LINE_H, { width: w - 8, lineBreak: false });
    });
    x += w;
  }
}

/** Total height a table would need if drawn in one block — used to decide
 * whether to push it onto a fresh page instead of splitting it mid-table. */
function measureTableHeight(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): number {
  let total = rowHeightForLines(Math.max(...wrapRow(doc, headers, colWidths, true).map((l) => l.length)));
  for (const row of rows) {
    total += rowHeightForLines(Math.max(...wrapRow(doc, row, colWidths, false).map((l) => l.length)));
  }
  return total;
}

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  startY: number,
  contentBottom: number,
): number {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  let segmentStartY = startY;
  let segmentH = 0;
  let y = startY;

  const strokeSegmentBorder = () => {
    if (segmentH === 0) return;
    doc.rect(MARGIN, segmentStartY, totalW, segmentH)
      .lineWidth(0.5).strokeColor(C.border).stroke();
  };

  const drawHeader = () => {
    const wrapped = wrapRow(doc, headers, colWidths, true);
    const h = rowHeightForLines(Math.max(...wrapped.map((l) => l.length)));
    doc.rect(MARGIN, y, totalW, h).fill(C.tableHeader);
    renderWrappedRow(doc, wrapped, colWidths, y, true);
    y += h;
    segmentH += h;
  };

  drawHeader();

  for (let i = 0; i < rows.length; i++) {
    const wrapped = wrapRow(doc, rows[i], colWidths, false);
    const h = rowHeightForLines(Math.max(...wrapped.map((l) => l.length)));
    // Page break: closes the current segment's border and redraws the header.
    if (y + h > contentBottom) {
      strokeSegmentBorder();
      doc.addPage();
      y = MARGIN;
      segmentStartY = y;
      segmentH = 0;
      drawHeader();
    }
    doc.rect(MARGIN, y, totalW, h).fill(i % 2 === 0 ? '#ffffff' : C.rowAlt);
    renderWrappedRow(doc, wrapped, colWidths, y, false);
    y += h;
    segmentH += h;
  }

  strokeSegmentBorder();
  return y;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

interface QuickWin {
  label: string;
  monthlyCostUsd: number;
}

function buildQuickWins(summary: WastedResourcesSummary): QuickWin[] {
  return summary.findings
    .map((finding) => ({
      label: presenterFor(finding.kind).recommend(finding),
      monthlyCostUsd: finding.costEstimate.monthlyCostUsd,
    }))
    .sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd)
    .slice(0, 8);
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
    (total, { label }) => total + rowHeightForLines(wrapToLines(doc, label, labelW, MAX_CELL_LINES).length),
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
    const labelLines = wrapToLines(doc, wins[i].label, labelW, MAX_CELL_LINES);
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

    // Label — wrapped above, up to MAX_CELL_LINES, instead of clipped to one.
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
