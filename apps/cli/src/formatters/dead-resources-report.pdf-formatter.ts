// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'fs';
import { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META, groupByKind } from 'dead-resources-domain';
import type { DeadResourcesSummary, DeadResourceSeverity } from 'dead-resources-domain';
import { DEAD_RESOURCES_REPORT_DISCLAIMER } from 'dead-resources-application';
import { presenterFor, rowFor, recommendFor } from './dead-resource-presenters';
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

export interface DeadResourcesReportPdfMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

const SEVERITY_RANK: Record<DeadResourceSeverity, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_COLOR: Record<DeadResourceSeverity, string> = { critical: C.danger, warning: C.warning, info: C.muted };

export async function generateDeadResourcesReportPdf(
  summary: DeadResourcesSummary,
  meta: DeadResourcesReportPdfMeta,
  outputPath: string,
): Promise<void> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const disclaimerH = measureDisclaimerHeight(doc, DEAD_RESOURCES_REPORT_DISCLAIMER);
    const contentBottom = PAGE_H - MARGIN - footerReservedHeight(disclaimerH);
    doc.on('pageAdded', () => drawFooter(doc, DEAD_RESOURCES_REPORT_DISCLAIMER, disclaimerH));
    doc.addPage();

    drawSummaryPage(doc, summary, meta, contentBottom);
    drawDetailPages(doc, summary, contentBottom);

    doc.end();
  });
}

// ─── Summary page ────────────────────────────────────────────────────────────

function drawSummaryPage(
  doc: PDFKit.PDFDocument,
  summary: DeadResourcesSummary,
  meta: DeadResourcesReportPdfMeta,
  contentBottom: number,
): void {
  const bandH = drawMasthead(doc, 'cloudrift', 'AWS Dead/Unused Resources Report');
  let y = bandH + 24;

  const metaParts: string[] = [`Generated: ${meta.generatedAt.toISOString().split('T')[0]}`];
  if (meta.accountId !== 'unknown') metaParts.push(`Account: ${meta.accountId}`);
  metaParts.push(`Regions: ${meta.regions.join(', ')}`);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
    .text(metaParts.join('   ·   '), MARGIN, y, { lineBreak: false });

  y += 18;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).strokeColor(C.border).stroke();
  y += 14;

  const { info, warning, critical } = summary.countBySeverity;
  y = ensureSpace(doc, y, 90, contentBottom);
  drawMetricBox(doc, MARGIN, y, 108, 'TOTAL FINDINGS', String(summary.findings.length), C.text);
  drawMetricBox(doc, MARGIN + 118, y, 108, 'CRITICAL', String(critical), C.danger);
  drawMetricBox(doc, MARGIN + 236, y, 108, 'WARNING', String(warning), C.warning);
  drawMetricBox(doc, MARGIN + 354, y, 123, 'INFO', String(info), C.muted);
  y += 90;

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
    .text('Breakdown by check', MARGIN, y, { lineBreak: false });
  y += 16;
  const breakdownRows = buildBreakdownRows(summary);
  const breakdownHeaders = ['Check', 'Found'];
  const breakdownColWidths = computeColumnWidths(doc, breakdownHeaders, breakdownRows, CONTENT_W);
  y = ensureSpace(doc, y, measureTableHeight(doc, breakdownHeaders, breakdownRows, breakdownColWidths), contentBottom);
  y = drawTable(doc, breakdownHeaders, breakdownRows, breakdownColWidths, y, contentBottom);

  const topFindings = buildTopFindings(summary);
  if (topFindings.length > 0) {
    y += 20;
    y = ensureSpace(doc, y, 16 + measureRecommendationsHeight(doc, topFindings), contentBottom);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
      .text('Top findings — most severe first', MARGIN, y, { lineBreak: false });
    y += 16;
    y = drawRecommendations(doc, topFindings, y, contentBottom);
  }

  if (summary.scanErrors.length > 0) {
    y += 16;
    y = ensureSpace(doc, y, 14, contentBottom);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.warning)
      .text('Scan warnings — partial results:', MARGIN, y, { lineBreak: false });
    y += 14;
    for (const { kind, region, error } of summary.scanErrors) {
      const text = `• ${kind} in ${region}: ${error.message}`;
      doc.font('Helvetica').fontSize(8.5);
      const lineH = doc.heightOfString(text, { width: CONTENT_W - 8 });
      y = ensureSpace(doc, y, lineH + 4, contentBottom);
      doc.fillColor(C.warning).text(text, MARGIN + 8, y, { width: CONTENT_W - 8 });
      y += lineH + 4;
    }
  }
}

// ─── Detail pages ─────────────────────────────────────────────────────────────

function drawDetailPages(doc: PDFKit.PDFDocument, summary: DeadResourcesSummary, contentBottom: number): void {
  const grouped = groupByKind(summary.findings);

  for (const kind of DEAD_RESOURCE_KINDS) {
    const findings = grouped[kind];
    if (findings.length === 0) continue;

    const presenter = presenterFor(kind);
    doc.addPage();
    const y = sectionHeader(doc, presenter.title);
    const rows = findings.map((finding) => [...rowFor(finding), finding.severity]);
    const headers = [...presenter.head, 'Severity'];
    const colWidths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    drawTable(doc, headers, rows, colWidths, y, contentBottom);
  }
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): number {
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.primary)
    .text(title, MARGIN, MARGIN, { lineBreak: false });
  return MARGIN + 26;
}

// ─── Top findings (severity-ranked, capped) ────────────────────────────────────

interface TopFinding {
  label: string;
  severity: DeadResourceSeverity;
}

function buildTopFindings(summary: DeadResourcesSummary): TopFinding[] {
  // Routed through groupByKind (not summary.findings directly) so `finding`
  // keeps the kind↔entity correlation recommendFor's switch relies on —
  // same reasoning as waste-report.pdf-formatter's buildQuickWins.
  const grouped = groupByKind(summary.findings);
  const findings: TopFinding[] = [];
  for (const kind of DEAD_RESOURCE_KINDS) {
    for (const finding of grouped[kind]) {
      findings.push({ label: recommendFor(finding), severity: finding.severity });
    }
  }
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 8);
}

// Fixed overhead around the label column: 22 (index area) + 4 (gap) + 64
// (severity badge width) + 8 (right padding, so the badge doesn't sit flush
// against the table border) = 98. labelW must leave exactly this much room.
const RECOMMENDATION_FIXED_W = 98;

function measureRecommendationsHeight(doc: PDFKit.PDFDocument, findings: TopFinding[]): number {
  doc.font('Helvetica').fontSize(8.5);
  const labelW = CONTENT_W - RECOMMENDATION_FIXED_W;
  return findings.reduce(
    (total, { label }) => total + rowHeightForLines(wrapToLines(doc, label, labelW).length),
    0,
  );
}

function drawRecommendations(
  doc: PDFKit.PDFDocument,
  findings: TopFinding[],
  startY: number,
  contentBottom: number,
): number {
  let y = startY;
  let segmentStartY = startY;
  let segmentH = 0;
  const labelW = CONTENT_W - RECOMMENDATION_FIXED_W;

  const strokeSegmentBorder = () => {
    if (segmentH === 0) return;
    doc.rect(MARGIN, segmentStartY, CONTENT_W, segmentH).lineWidth(0.5).strokeColor(C.border).stroke();
  };

  for (let i = 0; i < findings.length; i++) {
    doc.font('Helvetica').fontSize(8.5);
    const labelLines = wrapToLines(doc, findings[i].label, labelW);
    const h = rowHeightForLines(labelLines.length);

    if (y + h > contentBottom) {
      strokeSegmentBorder();
      doc.addPage();
      y = MARGIN;
      segmentStartY = y;
      segmentH = 0;
    }

    const bg = i % 2 === 0 ? '#ffffff' : C.rowAlt;
    doc.rect(MARGIN, y, CONTENT_W, h).fill(bg);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted)
      .text(`${i + 1}.`, MARGIN + 4, y + 6, { width: 16, lineBreak: false });

    doc.font('Helvetica').fontSize(8.5).fillColor(C.text);
    labelLines.forEach((line, li) => {
      doc.text(line, MARGIN + 22, y + 6 + li * LINE_H, { width: labelW, lineBreak: false });
    });

    doc.font('Helvetica-Bold').fontSize(8).fillColor(SEVERITY_COLOR[findings[i].severity])
      .text(findings[i].severity, MARGIN + 22 + labelW + 4, y + 6, { width: 64, align: 'right', lineBreak: false });

    y += h;
    segmentH += h;
  }

  strokeSegmentBorder();
  return y;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBreakdownRows(summary: DeadResourcesSummary): string[][] {
  const grouped = groupByKind(summary.findings);

  return DEAD_RESOURCE_KINDS.filter((kind) => grouped[kind].length > 0).map((kind) => [
    DEAD_RESOURCE_KIND_META[kind].label,
    String(grouped[kind].length),
  ]);
}
