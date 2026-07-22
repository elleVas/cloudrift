// SPDX-License-Identifier: Apache-2.0
import { wrapToLines, computeColumnWidths, CONTENT_W } from './pdf-shared';

async function makeDoc(): Promise<PDFKit.PDFDocument> {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
  doc.addPage();
  doc.font('Helvetica').fontSize(8.5);
  return doc;
}

describe('wrapToLines', () => {
  it('hard-breaks a single space-free token wider than maxW instead of returning it unwrapped', async () => {
    const doc = await makeDoc();
    // A CloudWatch log group path — no spaces at all, routine in AWS
    // identifiers — which is exactly the shape that slipped through
    // unmeasured before the fix (see waste-report PDF regression, 2026-07-22).
    const path = '/aws/lambda/CloudriftTestStack-CustomS3AutoDeleteObjectsCustom-WL2dFOuW2Nmc';
    const maxW = 140;

    const lines = wrapToLines(doc, path, maxW, 2);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(doc.widthOfString(line)).toBeLessThanOrEqual(maxW);
    }
  });

  it('still wraps normally on spaces when the text has them', async () => {
    const doc = await makeDoc();
    const lines = wrapToLines(doc, 'Set a retention policy on this log group', 100, 3);
    for (const line of lines) {
      expect(doc.widthOfString(line)).toBeLessThanOrEqual(100);
    }
  });

  it('never returns more than maxLines, folding the remainder into an ellipsized last line', async () => {
    const doc = await makeDoc();
    const path = '/aws/lambda/CloudriftTestStack-CustomS3AutoDeleteObjectsCustom-WL2dFOuW2Nmc-extra-long-suffix-here';
    const lines = wrapToLines(doc, path, 80, 2);
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});

describe('computeColumnWidths', () => {
  it('gives a column with long content more width than one with short content', async () => {
    const doc = await makeDoc();
    const headers = ['Log Group', 'Region'];
    const rows = [
      ['/aws/lambda/CloudriftTestStack-CustomS3AutoDeleteObjectsCustom-WL2dFOuW2Nmc', 'us-east-1'],
    ];
    const [logGroupW, regionW] = computeColumnWidths(doc, headers, rows, CONTENT_W);
    expect(logGroupW).toBeGreaterThan(regionW);
  });

  it('sums to totalWidth', async () => {
    const doc = await makeDoc();
    const headers = ['A', 'B', 'C'];
    const rows = [['short', 'also short', 'x']];
    const widths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(CONTENT_W, 5);
  });

  it('shrinks, never below the minimum, when natural widths exceed totalWidth', async () => {
    const doc = await makeDoc();
    const headers = ['A', 'B', 'C', 'D', 'E', 'F'];
    const longCell = 'x'.repeat(300);
    const rows = [[longCell, longCell, longCell, longCell, longCell, longCell]];
    const widths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    for (const w of widths) {
      expect(w).toBeGreaterThan(0);
    }
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CONTENT_W + 1);
  });

  it('shrinks the widest column first, leaving short structured columns (dates, single words) at their natural width', async () => {
    const doc = await makeDoc();
    // Reproduces the reported bug: a Function/Log Group column wide enough
    // to force overflow, alongside short atomic-token columns that used to
    // get squeezed below their own header/value width by proportional
    // shrink, wrapping "Invocations" -> "Invocation"/"s" and a date like
    // "2026-07-13" -> "2026-07-1"/"3" even though the wide column alone had
    // plenty of room to give up (2026-07-22).
    const headers = ['Function', 'Region', 'Memory', 'Invocations', 'Window', 'Cost/mo'];
    const rows = [[
      'EllevasDnsCertificateStac-CustomCrossRegionExportW-kqeADsQEpqg4',
      'us-east-1',
      '128 MB',
      '0',
      '7d',
      '$0.00/mo',
    ]];
    const widths = computeColumnWidths(doc, headers, rows, CONTENT_W);

    doc.font('Helvetica-Bold').fontSize(8.5);
    for (let i = 1; i < headers.length; i++) {
      const headerW = doc.widthOfString(headers[i]);
      // -8 mirrors wrapRow's colWidths[i] - 8 cell padding.
      expect(widths[i] - 8).toBeGreaterThanOrEqual(headerW);
    }
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(CONTENT_W, 5);
  });

  it('splits the squeeze between two comparably-wide columns instead of crushing one to the minimum', async () => {
    const doc = await makeDoc();
    // Reproduces a follow-up bug found while visually re-verifying the fix:
    // "Log Group" and "Function (deleted)" are both long AWS identifiers of
    // similar length. Shrinking only the single widest column drove it all
    // the way down to MIN_COL_W while its equally-wide neighbor stayed at
    // full natural width, producing a deeply hard-broken 7-line-tall column
    // next to an untouched one (2026-07-22).
    const headers = ['Log Group', 'Function (deleted)', 'Region', 'Stored', 'Last Event', 'Cost/mo'];
    const rows = [[
      '/aws/lambda/CloudriftTestStack-CustomS3AutoDeleteObjectsCustom-WL2dFOuW2Nmc',
      'CloudriftTestStack-CustomS3AutoDeleteObjectsCustom-WL2dFOuW2Nmc',
      'us-east-1',
      '0.0 GB',
      '2026-07-13',
      '$0.00/mo',
    ]];
    const widths = computeColumnWidths(doc, headers, rows, CONTENT_W);
    const [logGroupW, functionW] = widths;
    // Neither wide column should be forced anywhere near MIN_COL_W while
    // the other is left untouched — they should land close to each other.
    expect(Math.abs(logGroupW - functionW)).toBeLessThan(30);
    expect(logGroupW).toBeGreaterThan(80);
    expect(functionW).toBeGreaterThan(80);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(CONTENT_W, 5);
  });
});
