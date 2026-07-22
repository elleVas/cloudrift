// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'fs';
import type { CostComparisonSummary } from 'cloud-cost-domain';
import type { CostAnalyticsMeta } from 'cloud-cost-application';
import { COST_REPORT_DISCLAIMER } from 'cloud-cost-application';
import {
  C,
  PAGE_H,
  MARGIN,
  CONTENT_W,
  drawMasthead,
  ensureSpace,
  measureDisclaimerHeight,
  footerReservedHeight,
  drawFooter,
  drawMetricBox,
  measureTableHeight,
  drawTable,
  computeColumnWidths,
} from './pdf-shared';

export async function generateCostComparisonPdf(
  summary: CostComparisonSummary,
  meta: CostAnalyticsMeta,
  outputPath: string,
): Promise<void> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const disclaimerH = measureDisclaimerHeight(doc, COST_REPORT_DISCLAIMER);
    const contentBottom = PAGE_H - MARGIN - footerReservedHeight(disclaimerH);
    doc.on('pageAdded', () => drawFooter(doc, COST_REPORT_DISCLAIMER, disclaimerH));
    doc.addPage();

    drawPage(doc, summary, meta, contentBottom);

    doc.end();
  });
}

function drawPage(
  doc: PDFKit.PDFDocument,
  summary: CostComparisonSummary,
  meta: CostAnalyticsMeta,
  contentBottom: number,
): void {
  const bandH = drawMasthead(doc, 'cloudrift', 'AWS Cost Comparison Report');
  let y = bandH + 24;

  const metaParts = [
    `Generated: ${meta.generatedAt.toISOString().split('T')[0]}`,
    `Account: ${meta.accountId}`,
    // "to", not "→": pdfkit's built-in Helvetica is WinAnsi-encoded and has
    // no glyph for U+2192, so the arrow rendered as garbage ("!'").
    `Current: ${summary.current.start} to ${summary.current.end}`,
    `Previous: ${summary.previous.start} to ${summary.previous.end}`,
  ];
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
    .text(metaParts.join('   ·   '), MARGIN, y, { width: CONTENT_W });

  y += 32;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).strokeColor(C.border).stroke();
  y += 14;

  const changeColor = summary.changeUsd > 0 ? C.danger : summary.changeUsd < 0 ? '#16a34a' : C.text;
  const changeLabel =
    summary.changePercent === null
      ? `${summary.changeUsd >= 0 ? '+' : ''}$${summary.changeUsd.toFixed(2)}`
      : `${summary.changeUsd >= 0 ? '+' : ''}$${summary.changeUsd.toFixed(2)} (${summary.changePercent >= 0 ? '+' : ''}${summary.changePercent.toFixed(1)}%)`;

  y = ensureSpace(doc, y, 90, contentBottom);
  drawMetricBox(doc, MARGIN, y, 152, 'CURRENT PERIOD', `$${summary.current.totalUsd.toFixed(2)}`, C.text);
  drawMetricBox(doc, MARGIN + 162, y, 152, 'PREVIOUS PERIOD', `$${summary.previous.totalUsd.toFixed(2)}`, C.text);
  drawMetricBox(doc, MARGIN + 324, y, 123, 'CHANGE', changeLabel, changeColor);
  y += 90;

  if (summary.byService.length > 0) {
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
      .text('By service — biggest movers first', MARGIN, y, { lineBreak: false });
    y += 16;
    const headers = ['Service', 'Current', 'Previous', 'Change'];
    const rows = summary.byService.map((s) => [
      s.service,
      `$${s.currentUsd.toFixed(2)}`,
      `$${s.previousUsd.toFixed(2)}`,
      s.changePercent === null
        ? `${s.changeUsd >= 0 ? '+' : ''}$${s.changeUsd.toFixed(2)}`
        : `${s.changeUsd >= 0 ? '+' : ''}$${s.changeUsd.toFixed(2)} (${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(1)}%)`,
    ]);
    const colWidths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    y = ensureSpace(doc, y, measureTableHeight(doc, headers, rows, colWidths), contentBottom);
    drawTable(doc, headers, rows, colWidths, y, contentBottom);
  }
}
