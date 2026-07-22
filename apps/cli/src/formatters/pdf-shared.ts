// SPDX-License-Identifier: Apache-2.0
import { REPORT_CONTACT } from 'cloud-cost-application';
import { PDF_LOGO_PNG_BASE64 } from '../pdf-logo-data';

/**
 * Layout/drawing primitives shared by every PDF report (waste, cost
 * comparison, spend trend) — masthead (with the real embedded logo),
 * footer, and the table/metric-box drawing routines. Extracted out of
 * waste-report.pdf-formatter.ts (the first PDF this codebase had) so the
 * newer cost/trend PDFs don't duplicate ~200 lines of pdfkit boilerplate,
 * and so all three reports stay visually consistent by construction.
 */
export const C = {
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

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const ROW_H = 20;
export const LINE_H = 11;

const LOGO_PNG = Buffer.from(PDF_LOGO_PNG_BASE64, 'base64');

/** Full-bleed dark band with the real cloudrift logo, title, subtitle, and accent bar. Returns the y-coordinate content should start at. */
export function drawMasthead(doc: PDFKit.PDFDocument, title: string, subtitle: string): number {
  const bandH = 84;
  doc.rect(0, 0, PAGE_W, bandH).fill(C.bannerBg);

  const logoSize = 48;
  const logoX = MARGIN;
  const logoY = (bandH - logoSize) / 2;
  doc.image(LOGO_PNG, logoX, logoY, { width: logoSize, height: logoSize });

  const textX = logoX + logoSize + 16;
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.bannerTitle)
    .text(title, textX, bandH / 2 - 20, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(C.bannerSubtitle)
    .text(subtitle, textX, bandH / 2 + 6, { lineBreak: false });
  doc.rect(textX, bandH - 6, 56, 3).fill(C.bannerAccent);

  return bandH;
}

/** A row's height grows past ROW_H only when one of its cells actually wraps. */
export function rowHeightForLines(lineCount: number): number {
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
export function ensureSpace(
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
export function measureDisclaimerHeight(doc: PDFKit.PDFDocument, disclaimer: string): number {
  return doc.font('Helvetica').fontSize(7).heightOfString(disclaimer, { width: CONTENT_W });
}

/** Total footer height (gap + divider + disclaimer + contact), used to compute a page's usable content bottom. */
export function footerReservedHeight(disclaimerH: number): number {
  return FOOTER_GAP + FOOTER_TOP_PAD + disclaimerH + FOOTER_MID_PAD + FOOTER_CONTACT_H;
}

/** Draws the disclaimer + contact footer at a fixed position near the bottom
 * of whichever page is currently active — called on every page via 'pageAdded'
 * so it's never orphaned on its own page and never missing from any page. */
export function drawFooter(doc: PDFKit.PDFDocument, disclaimer: string, disclaimerH: number): void {
  let y = PAGE_H - MARGIN - (FOOTER_TOP_PAD + disclaimerH + FOOTER_MID_PAD + FOOTER_CONTACT_H);
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(C.border).stroke();
  y += FOOTER_TOP_PAD;
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
    .text(disclaimer, MARGIN, y, { width: CONTENT_W });
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

export function drawMetricBox(
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

/**
 * Greedy word-wrap. By default there is no line cap: a cell simply grows to
 * however many lines its content needs, and the caller sizes the row to
 * match (see `rowHeightForLines`) — tables must show every character, never
 * cut content off with an ellipsis (2026-07-22: user reported truncated
 * "Function (deleted)"/"Log Group" cells and truncated recommendation text
 * in the waste-report PDF). Pass an explicit finite `maxLines` only for the
 * rare spot that genuinely wants a hard cap with an ellipsis fallback.
 *
 * A single "word" (space-delimited token) that's on its own wider than
 * `maxW` — routine for AWS identifiers like log group paths or ARNs, which
 * have plenty of `/` and `-` but zero spaces — used to sail through
 * unmeasured: the greedy loop below only ever checks width once `current`
 * is non-empty, so the very first long token was never split, and this
 * function reported it as one line. But the caller renders each line with
 * `doc.text(..., { width, lineBreak: false })`, and pdfkit's own renderer
 * *does* hard-wrap an overlong line at render time — just onto more lines
 * than this function had sized the row for, so the extra line spilled into
 * the row below. `hardBreak` below guarantees every returned line actually
 * fits `maxW`, so what gets measured always matches what gets drawn.
 */
export function wrapToLines(
  doc: PDFKit.PDFDocument,
  text: string,
  maxW: number,
  maxLines = Infinity,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (doc.widthOfString(word) > maxW) {
      if (current) {
        lines.push(current);
        current = '';
      }
      const [head, tail] = hardBreak(doc, word, maxW);
      lines.push(...head);
      current = tail;
      continue;
    }
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

/** Character-level fallback for a single token wider than `maxW` on its own — returns every full line it produces plus whatever's left over (short enough to fit, handed back so the caller can keep accumulating onto it). */
function hardBreak(doc: PDFKit.PDFDocument, word: string, maxW: number): [string[], string] {
  const lines: string[] = [];
  let rest = word;
  while (doc.widthOfString(rest) > maxW) {
    let cut = rest.length;
    while (cut > 1 && doc.widthOfString(rest.slice(0, cut)) > maxW) cut--;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return [lines, rest];
}

function clip(doc: PDFKit.PDFDocument, text: string, maxW: number): string {
  if (doc.widthOfString(text) <= maxW) return text;
  let s = text;
  while (s.length > 0 && doc.widthOfString(s + '…') > maxW) s = s.slice(0, -1);
  return s + '…';
}

const CELL_PADDING = 8; // matches wrapRow's `colWidths[i] - 8` and renderWrappedRow's `x + 4` each side
// Small safety margin above the exact measured width, so a column sized
// to fit one atomic token (a header word, a date, "us-east-1") never sits
// at a pixel-exact boundary where it wraps anyway — that produced ugly
// mid-word breaks like "Invocation"/"s" and "2026-07-1"/"3" even though
// the column was nominally wide enough (2026-07-22).
const WIDTH_SAFETY_MARGIN = 2;
const MIN_COL_W = 50;

/**
 * Sizes every column from what's actually in it (header + every row's
 * cell, at the same font/size the table renders with) instead of a fixed
 * hand-tuned ratio — the previous approach (`resource-presenters.ts`'s
 * `colWidths`, one static array per resource kind) had no way to know a
 * given kind's real data would include something like a 70-character log
 * group path, so that column was sized for a *guess* instead of the
 * content, and the text overflowed into the row below once `wrapToLines`
 * needed more lines than the guessed width allowed.
 *
 * Columns whose content fits get exactly what they need (never more);
 * any width left over after that goes to the widest column (almost always
 * the free-text one) so the table still fills `totalWidth`.
 *
 * If the natural widths don't all fit, shrink starts from the *widest*
 * column instead of squeezing every column proportionally: the widest
 * column is almost always the free-text one (a log group path, a function
 * name) that can already absorb extra wrapped lines cleanly via
 * `wrapToLines`'s hard-break, whereas short structured columns (a date,
 * "Invocations", "us-east-1") hold a single atomic token that only has an
 * ugly mid-word break available. Squeezing those first (the old
 * proportional approach) wrapped them for no reason even though the wide
 * column alone had plenty of room to give up.
 */
export function computeColumnWidths(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  totalWidth: number,
): number[] {
  doc.font('Helvetica-Bold').fontSize(8.5);
  const headerWidths = headers.map((h) => doc.widthOfString(h) + CELL_PADDING + WIDTH_SAFETY_MARGIN);

  doc.font('Helvetica').fontSize(8.5);
  const contentWidths = headers.map((_, i) =>
    rows.reduce((max, row) => Math.max(max, doc.widthOfString(row[i] ?? '')), 0) + CELL_PADDING + WIDTH_SAFETY_MARGIN,
  );

  const natural = headers.map((_, i) => Math.max(headerWidths[i], contentWidths[i], MIN_COL_W));
  const naturalSum = natural.reduce((a, b) => a + b, 0);

  if (naturalSum <= totalWidth) {
    const extra = totalWidth - naturalSum;
    const widestIndex = natural.indexOf(Math.max(...natural));
    return natural.map((w, i) => (i === widestIndex ? w + extra : w));
  }

  return shrinkWidestFirst(natural, totalWidth);
}

/**
 * Water-fills the reduction down from the top: only the currently-widest
 * column(s) give up space, down to the next width level (or `MIN_COL_W`),
 * before anything narrower is touched. When two columns are comparably wide
 * (e.g. a "Log Group" column next to a "Function (deleted)" column with
 * near-identical path lengths), the squeeze is split between them instead
 * of a naive "shrink the single widest one first" crushing just that one
 * column down to the floor while its equally-wide neighbor stays
 * untouched — that produced an absurdly narrow, deeply hard-broken column
 * even though the neighbor had just as much room to share (2026-07-22).
 */
function shrinkWidestFirst(natural: number[], totalWidth: number): number[] {
  const widths = [...natural];
  let overBy = widths.reduce((a, b) => a + b, 0) - totalWidth;
  let guard = widths.length * 2;
  while (overBy > 0.01 && guard-- > 0) {
    const maxW = Math.max(...widths);
    const atMax = widths.map((_, i) => i).filter((i) => widths[i] === maxW && widths[i] > MIN_COL_W);
    if (atMax.length === 0) break;
    const below = widths.filter((w) => w < maxW);
    const nextLevel = Math.max(MIN_COL_W, below.length > 0 ? Math.max(...below) : MIN_COL_W);
    const totalRoom = (maxW - nextLevel) * atMax.length;
    if (totalRoom <= overBy) {
      for (const i of atMax) widths[i] = nextLevel;
      overBy -= totalRoom;
    } else {
      const share = overBy / atMax.length;
      for (const i of atMax) widths[i] -= share;
      overBy = 0;
    }
  }
  return widths;
}

/** Wraps every cell in a row — uncapped, so a cell never loses content to
 * an ellipsis, only grows the row. Font/size must be set BEFORE measuring,
 * since doc.widthOfString() uses whatever font is active. */
function wrapRow(doc: PDFKit.PDFDocument, cells: string[], colWidths: number[], bold: boolean): string[][] {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
  return cells.map((cell, i) => wrapToLines(doc, cell, colWidths[i] - 8));
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
export function measureTableHeight(
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

export function drawTable(
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
