// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'fs';
import type { CostTrendSummary } from 'cost-analytics-domain';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import { COST_REPORT_DISCLAIMER } from 'cost-analytics-application';
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
} from './pdf-shared';

export async function generateCostTrendPdf(
  summary: CostTrendSummary,
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
  summary: CostTrendSummary,
  meta: CostAnalyticsMeta,
  contentBottom: number,
): void {
  const bandH = drawMasthead(doc, 'cloudrift', 'AWS Monthly Spend Trend');
  let y = bandH + 24;

  const scope = summary.filteredServices?.length ? summary.filteredServices.join(', ') : 'all services';
  const metaParts = [
    `Generated: ${meta.generatedAt.toISOString().split('T')[0]}`,
    `Account: ${meta.accountId}`,
    `Scope: ${scope}`,
  ];
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
    .text(metaParts.join('   ·   '), MARGIN, y, { width: CONTENT_W });

  y += 32;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).strokeColor(C.border).stroke();
  y += 20;

  drawBarChart(doc, summary, y, contentBottom);
}

const BAR_ROW_H = 28;
const LABEL_W = 64;
const VALUE_W = 90;

function drawBarChart(
  doc: PDFKit.PDFDocument,
  summary: CostTrendSummary,
  startY: number,
  contentBottom: number,
): void {
  const barAreaX = MARGIN + LABEL_W;
  const barAreaW = CONTENT_W - LABEL_W - VALUE_W;
  const maxUsd = Math.max(...summary.months.map((m) => m.totalUsd), 0.01);

  let y = startY;
  for (const month of summary.months) {
    y = ensureSpace(doc, y, BAR_ROW_H, contentBottom);
    const barW = Math.max((month.totalUsd / maxUsd) * barAreaW, month.totalUsd > 0 ? 3 : 0);
    const barH = 14;
    const barY = y + (BAR_ROW_H - barH) / 2;

    doc.font('Helvetica').fontSize(8.5).fillColor(C.text)
      .text(month.month, MARGIN, y + (BAR_ROW_H - 10) / 2, { width: LABEL_W - 8, lineBreak: false });

    doc.rect(barAreaX, barY, barAreaW, barH).fillAndStroke('#f3f4f6', C.border);
    if (barW > 0) {
      doc.rect(barAreaX, barY, barW, barH).fill(month.final ? C.primary : '#93c5fd');
    }

    const valueLabel = `$${month.totalUsd.toFixed(2)}${month.final ? '' : ' (est.)'}`;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
      .text(valueLabel, barAreaX + barAreaW + 8, y + (BAR_ROW_H - 10) / 2, { width: VALUE_W - 8, lineBreak: false });

    y += BAR_ROW_H;
  }
}
