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
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ROW_H = 20;

export function generateWasteReportPdf(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    drawSummaryPage(doc, summary, meta);
    drawDetailPages(doc, summary);

    doc.end();
  });
}

// ─── Summary page ────────────────────────────────────────────────────────────

function drawSummaryPage(
  doc: PDFKit.PDFDocument,
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
): void {
  let y = MARGIN;

  // Title
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.primary)
    .text('CloudRift', MARGIN, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor(C.muted)
    .text('AWS Waste Detection Report', MARGIN, y + 30, { lineBreak: false });

  // Metadata
  y += 58;
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

  drawMetricBox(doc, MARGIN, y, 152, 'MONTHLY WASTE', monthlyLabel, C.danger);
  drawMetricBox(doc, MARGIN + 162, y, 152, 'ANNUAL WASTE', annualLabel, C.warning);
  drawMetricBox(doc, MARGIN + 324, y, 123, 'RESOURCES FOUND', String(total), C.text);

  // Waste breakdown
  y += 90;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
    .text('Waste breakdown by resource type', MARGIN, y, { lineBreak: false });
  y += 16;
  y = drawTable(doc, ['Resource type', 'Found', 'Est. cost/month'], buildBreakdownRows(summary, 'waste'), [290, 60, 149], y);

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
    y = drawTable(doc, ['Resource type', 'Found', 'Est. saving/month'], optimizationRows, [290, 60, 149], y);
  }

  // Recommendations
  const wins = buildQuickWins(summary);
  if (wins.length > 0) {
    y += 20;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
      .text('Top recommendations — sorted by monthly impact', MARGIN, y, { lineBreak: false });
    y += 16;
    y = drawRecommendations(doc, wins, y);
  }

  // Warnings
  if (summary.scanErrors.length > 0) {
    y += 16;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.warning)
      .text('* Scan warnings — partial results:', MARGIN, y, { lineBreak: false });
    y += 14;
    for (const { kind, region, error } of summary.scanErrors) {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.warning)
        .text(`• ${RESOURCE_KIND_LABELS[kind]} in ${region}: ${error.message}`, MARGIN + 8, y, { width: CONTENT_W - 8 });
      y += 13;
    }
  }

  // Disclaimer + contact
  y += 18;
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(C.border).stroke();
  y += 10;
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
    .text(REPORT_DISCLAIMER, MARGIN, y, { width: CONTENT_W });
  y += doc.heightOfString(REPORT_DISCLAIMER, { width: CONTENT_W }) + 6;
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
    .text('LinkedIn', { link: REPORT_CONTACT.linkedin, underline: true });
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

// Larghezza riservata alla colonna "Approved by"; le altre colonne sono scalate
// per occupare lo spazio restante, indipendentemente dai colWidths del presenter.
const APPROVED_BY_W = 60;

function drawDetailPages(doc: PDFKit.PDFDocument, summary: WastedResourcesSummary): void {
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
      '______',
    ]);
    const scale = (CONTENT_W - APPROVED_BY_W) / presenter.colWidths.reduce((a, b) => a + b, 0);
    const colWidths = [...presenter.colWidths.map((w) => w * scale), APPROVED_BY_W];
    drawTable(doc, [...presenter.head, 'Cost/mo', 'Approved by'], rows, colWidths, y);
  }
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): number {
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.primary)
    .text(title, MARGIN, MARGIN, { lineBreak: false });
  return MARGIN + 26;
}

// ─── Table primitive ──────────────────────────────────────────────────────────

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  startY: number,
): number {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  let segmentStartY = startY;
  let y = startY;

  const strokeSegmentBorder = (rowsDrawn: number) => {
    doc.rect(MARGIN, segmentStartY, totalW, rowsDrawn * ROW_H)
      .lineWidth(0.5).strokeColor(C.border).stroke();
  };

  const drawHeader = () => {
    doc.rect(MARGIN, y, totalW, ROW_H).fill(C.tableHeader);
    renderRow(doc, headers, colWidths, y, true);
    y += ROW_H;
  };

  drawHeader();
  let rowsInSegment = 1;

  for (let i = 0; i < rows.length; i++) {
    // Salto pagina: chiude il bordo del segmento corrente e ridisegna l'header.
    if (y + ROW_H > PAGE_H - MARGIN) {
      strokeSegmentBorder(rowsInSegment);
      doc.addPage();
      y = MARGIN;
      segmentStartY = y;
      drawHeader();
      rowsInSegment = 1;
    }
    doc.rect(MARGIN, y, totalW, ROW_H).fill(i % 2 === 0 ? '#ffffff' : C.rowAlt);
    renderRow(doc, rows[i], colWidths, y, false);
    y += ROW_H;
    rowsInSegment++;
  }

  strokeSegmentBorder(rowsInSegment);
  return y;
}

function renderRow(
  doc: PDFKit.PDFDocument,
  cells: string[],
  colWidths: number[],
  y: number,
  bold: boolean,
): void {
  let x = MARGIN;
  for (let i = 0; i < cells.length; i++) {
    const w = colWidths[i];
    const text = clip(doc, cells[i], w - 8);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(C.text)
      .text(text, x + 4, y + 6, { width: w - 8, lineBreak: false });
    x += w;
  }
}

function clip(doc: PDFKit.PDFDocument, text: string, maxW: number): string {
  if (doc.widthOfString(text) <= maxW) return text;
  let s = text;
  while (s.length > 0 && doc.widthOfString(s + '…') > maxW) s = s.slice(0, -1);
  return s + '…';
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

function drawRecommendations(doc: PDFKit.PDFDocument, wins: QuickWin[], startY: number): number {
  let y = startY;
  const labelW = CONTENT_W - 130;

  for (let i = 0; i < wins.length; i++) {
    const { label, monthlyCostUsd } = wins[i];
    const annual = monthlyCostUsd * 12;
    const bg = i % 2 === 0 ? '#ffffff' : C.rowAlt;

    doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(bg);

    // Index
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted)
      .text(`${i + 1}.`, MARGIN + 4, y + 6, { width: 16, lineBreak: false });

    // Label
    const clippedLabel = clip(doc, label, labelW);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
      .text(clippedLabel, MARGIN + 22, y + 6, { width: labelW, lineBreak: false });

    // Monthly cost
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.danger)
      .text(`$${monthlyCostUsd.toFixed(2)}/mo`, MARGIN + 22 + labelW + 4, y + 6, { width: 66, align: 'right', lineBreak: false });

    // Annual cost
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(`$${annual.toFixed(0)}/yr`, MARGIN + 22 + labelW + 74, y + 6, { width: 40, align: 'right', lineBreak: false });

    y += ROW_H;
  }

  // Border around whole block
  doc.rect(MARGIN, startY, CONTENT_W, wins.length * ROW_H)
    .lineWidth(0.5).strokeColor(C.border).stroke();

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
