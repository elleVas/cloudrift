// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'fs';
import Table from 'cli-table3';
import chalk from 'chalk';
import { REPORT_CONTACT } from 'cloud-cost-application';
import type { AwsRegion } from 'cloud-cost-domain';
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

export type Severity = 'info' | 'warning' | 'critical';

export interface SeverityScanError<K extends string> {
  kind: K;
  region: string;
  error: Error;
}

export interface SeverityReportSummary<K extends string, G extends { kind: K; severity: Severity }> {
  findings: G[];
  countBySeverity: Record<Severity, number>;
  scanErrors: SeverityScanError<K>[];
}

export interface SeverityReportPdfMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

const SEVERITY_COLOR_TABLE: Record<Severity, (text: string) => string> = {
  info: chalk.dim,
  warning: chalk.yellow,
  critical: chalk.red,
};
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_COLOR_PDF: Record<Severity, string> = { critical: C.danger, warning: C.warning, info: C.muted };

// Fixed overhead around the label column in the PDF's "top findings" list: 22
// (index area) + 4 (gap) + 64 (severity badge width) + 8 (right padding, so
// the badge doesn't sit flush against the table border) = 98.
const RECOMMENDATION_FIXED_W = 98;

interface TopFinding {
  label: string;
  severity: Severity;
}

/**
 * Template method for the report shape shared by dead-resources and
 * resource-security: a per-kind finding list with info/warning/critical
 * counts, no dollar total (see ADR-0044, which found the same duplication
 * shape one layer down, in the CloudWatch scanners — the shared part is the
 * report *structure* itself, not just a leaf helper, so a base class removes
 * the duplication where a shared free function would not: the "stateful
 * injected collaborator" alternative in that ADR was rejected for the same
 * reason it would apply here). Deliberately NOT extended to waste-report
 * (different shape: category split + $ total, no severity) — same
 * reasoning ADR-0044 used to keep the one outlier scanner out of its
 * template rather than bending the shape to fit it.
 *
 * `G` is the general finding interface (`{ kind, severity, ... }`, what
 * `summary.findings` is actually typed as); `F` is the precise per-kind
 * union (e.g. a `KindMap[Kind]` union of concrete entity classes) that
 * `rowFor`/`recommendFor` dispatch on via ADR-0059's exhaustive switch. The
 * split exists so no new cast is introduced here — the widen-then-narrow
 * happens inside each domain's own `groupByKind`, same as before this
 * refactor.
 */
export abstract class SeverityReportFormatter<
  K extends string,
  G extends { kind: K; severity: Severity; id: string; region?: AwsRegion },
  F extends G = G,
> {
  protected abstract readonly kinds: readonly K[];
  protected abstract readonly reportTitle: string;
  protected abstract readonly noFindingsMessage: string;
  protected abstract readonly disclaimer: string;
  protected abstract kindLabel(kind: K): string;
  protected abstract groupByKind(findings: G[]): Record<K, F[]>;
  protected abstract presenterFor(kind: K): { title: string; head: string[] };
  protected abstract rowFor(finding: F): string[];
  protected abstract recommendFor(finding: F): string;

  // ─── Table ──────────────────────────────────────────────────────────────

  toTable(summary: SeverityReportSummary<K, G>): string {
    const lines: string[] = [];
    const grouped = this.groupByKind(summary.findings);

    let rendered = false;
    for (const kind of this.kinds) {
      const findings = grouped[kind];
      if (findings.length === 0) continue;
      rendered = true;

      const presenter = this.presenterFor(kind);
      lines.push(chalk.bold.yellow(`\n  ${presenter.title}`));
      const table = new Table({ head: [...presenter.head, 'Severity'], style: { head: ['cyan'] } });
      for (const finding of findings) {
        table.push([...this.rowFor(finding), SEVERITY_COLOR_TABLE[finding.severity](finding.severity)]);
      }
      lines.push(table.toString());
    }

    if (!rendered && summary.scanErrors.length === 0) {
      lines.push(chalk.green(`\n  ${this.noFindingsMessage}`));
    }

    if (summary.scanErrors.length > 0) {
      lines.push(chalk.bold.yellow('\n  Scan warnings — partial results (some scans could not complete):'));
      for (const { kind, region, error } of summary.scanErrors) {
        lines.push(chalk.yellow(`    • ${kind} in ${region}: ${error.message}`));
      }
    }

    const incomplete = summary.scanErrors.length > 0 ? chalk.yellow(' (incomplete — see warnings above)') : '';
    const { info, warning, critical } = summary.countBySeverity;
    lines.push(
      chalk.bold(
        `\n  Total: ${summary.findings.length} finding(s)${incomplete} — ` +
          `${critical} critical, ${warning} warning, ${info} info`,
      ),
    );
    lines.push(
      chalk.dim(`  Contact: ${REPORT_CONTACT.email} · ${REPORT_CONTACT.github} · ${REPORT_CONTACT.linkedin}\n`),
    );

    return lines.join('\n');
  }

  // ─── PDF ────────────────────────────────────────────────────────────────

  async toPdf(summary: SeverityReportSummary<K, G>, meta: SeverityReportPdfMeta, outputPath: string): Promise<void> {
    const { default: PDFDocument } = await import('pdfkit');
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
      const stream = createWriteStream(outputPath);
      doc.pipe(stream);
      stream.on('finish', resolve);
      stream.on('error', reject);

      const disclaimerH = measureDisclaimerHeight(doc, this.disclaimer);
      const contentBottom = PAGE_H - MARGIN - footerReservedHeight(disclaimerH);
      doc.on('pageAdded', () => drawFooter(doc, this.disclaimer, disclaimerH));
      doc.addPage();
      doc.outline.addItem('Summary');

      this.drawSummaryPage(doc, summary, meta, contentBottom);
      this.drawDetailPages(doc, summary, contentBottom);

      doc.end();
    });
  }

  private drawSummaryPage(
    doc: PDFKit.PDFDocument,
    summary: SeverityReportSummary<K, G>,
    meta: SeverityReportPdfMeta,
    contentBottom: number,
  ): void {
    const bandH = drawMasthead(doc, 'cloudrift', this.reportTitle);
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
    const breakdownRows = this.buildBreakdownRows(summary);
    const breakdownHeaders = ['Check', 'Found'];
    const breakdownColWidths = computeColumnWidths(doc, breakdownHeaders, breakdownRows, CONTENT_W);
    y = ensureSpace(doc, y, measureTableHeight(doc, breakdownHeaders, breakdownRows, breakdownColWidths), contentBottom);
    y = drawTable(doc, breakdownHeaders, breakdownRows, breakdownColWidths, y, contentBottom);

    const topFindings = this.buildTopFindings(summary);
    if (topFindings.length > 0) {
      y += 20;
      y = ensureSpace(doc, y, 16 + this.measureRecommendationsHeight(doc, topFindings), contentBottom);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
        .text('Top findings — most severe first', MARGIN, y, { lineBreak: false });
      y += 16;
      y = this.drawRecommendations(doc, topFindings, y, contentBottom);
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

  private drawDetailPages(doc: PDFKit.PDFDocument, summary: SeverityReportSummary<K, G>, contentBottom: number): void {
    const grouped = this.groupByKind(summary.findings);

    for (const kind of this.kinds) {
      const findings = grouped[kind];
      if (findings.length === 0) continue;

      const presenter = this.presenterFor(kind);
      doc.addPage();
      doc.outline.addItem(presenter.title);
      const y = this.sectionHeader(doc, presenter.title);
      const links = findings.map((finding) =>
        buildConsoleUrl({ kind: finding.kind, id: finding.id, region: finding.region?.code }),
      );
      const rows = findings.map((finding) => [
        ...this.rowFor(finding),
        finding.severity,
        '',
      ]);
      const headers = [...presenter.head, 'Severity', 'Link'];
      const colWidths = computeColumnWidths(doc, headers, rows, CONTENT_W);
      drawTable(doc, headers, rows, colWidths, y, contentBottom, links);
    }
  }

  private sectionHeader(doc: PDFKit.PDFDocument, title: string): number {
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.primary)
      .text(title, MARGIN, MARGIN, { lineBreak: false });
    return MARGIN + 26;
  }

  private buildTopFindings(summary: SeverityReportSummary<K, G>): TopFinding[] {
    // Routed through groupByKind (not summary.findings directly) so `finding`
    // keeps the kind↔entity correlation recommendFor's switch relies on.
    const grouped = this.groupByKind(summary.findings);
    const findings: TopFinding[] = [];
    for (const kind of this.kinds) {
      for (const finding of grouped[kind]) {
        findings.push({ label: this.recommendFor(finding), severity: finding.severity });
      }
    }
    return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 8);
  }

  private measureRecommendationsHeight(doc: PDFKit.PDFDocument, findings: TopFinding[]): number {
    doc.font('Helvetica').fontSize(8.5);
    const labelW = CONTENT_W - RECOMMENDATION_FIXED_W;
    return findings.reduce(
      (total, { label }) => total + rowHeightForLines(wrapToLines(doc, label, labelW).length),
      0,
    );
  }

  private drawRecommendations(
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

      doc.font('Helvetica-Bold').fontSize(8).fillColor(SEVERITY_COLOR_PDF[findings[i].severity])
        .text(findings[i].severity, MARGIN + 22 + labelW + 4, y + 6, { width: 64, align: 'right', lineBreak: false });

      y += h;
      segmentH += h;
    }

    strokeSegmentBorder();
    return y;
  }

  private buildBreakdownRows(summary: SeverityReportSummary<K, G>): string[][] {
    const grouped = this.groupByKind(summary.findings);
    return this.kinds
      .filter((kind) => grouped[kind].length > 0)
      .map((kind) => [this.kindLabel(kind), String(grouped[kind].length)]);
  }
}
