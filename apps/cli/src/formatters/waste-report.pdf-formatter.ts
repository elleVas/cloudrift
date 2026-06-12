import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import type { WastedResourcesSummary } from 'cloud-cost-domain';

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
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ROW_H = 20;

export interface PdfReportMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

export function generateWasteReportPdf(
  summary: WastedResourcesSummary,
  meta: PdfReportMeta,
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
  meta: PdfReportMeta,
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
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
    .text(metaParts.join('   ·   '), MARGIN, y, { lineBreak: false });

  // Divider
  y += 18;
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(C.border).stroke();

  // Metric boxes
  y += 14;
  const monthly = summary.totalMonthlyCostUsd;
  const annual = monthly * 12;
  const total = allResources(summary).length;
  const isIncomplete = summary.scanErrors.length > 0;

  const monthlyLabel = isIncomplete ? `$${monthly.toFixed(2)}/mo *` : `$${monthly.toFixed(2)}/mo`;
  const annualLabel = isIncomplete ? `$${annual.toFixed(2)}/yr *` : `$${annual.toFixed(2)}/yr`;

  drawMetricBox(doc, MARGIN, y, 152, 'MONTHLY WASTE', monthlyLabel, C.danger);
  drawMetricBox(doc, MARGIN + 162, y, 152, 'ANNUAL WASTE', annualLabel, C.warning);
  drawMetricBox(doc, MARGIN + 324, y, 123, 'RESOURCES FOUND', String(total), C.text);

  // Breakdown
  y += 90;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.text)
    .text('Breakdown by resource type', MARGIN, y, { lineBreak: false });
  y += 16;
  y = drawTable(doc, ['Resource type', 'Found', 'Est. cost/month'], buildBreakdownRows(summary), [290, 60, 149], y);

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
    for (const { resourceType, error } of summary.scanErrors) {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.warning)
        .text(`• ${resourceType}: ${error.message}`, MARGIN + 8, y, { width: CONTENT_W - 8 });
      y += 13;
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

function drawDetailPages(doc: PDFKit.PDFDocument, summary: WastedResourcesSummary): void {
  if (summary.ebsVolumes.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'EBS Volumes — Unattached');
    const rows = summary.ebsVolumes.map(v => [
      v.id, v.region.code, `${v.sizeGb} GB`, v.volumeType,
      fmt(v.createTime), `$${v.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['Volume ID', 'Region', 'Size', 'Type', 'Created', 'Cost/mo'], rows, [135, 80, 48, 48, 84, 80], y);
  }

  if (summary.elasticIps.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'Elastic IPs — Unassociated');
    const rows = summary.elasticIps.map(ip => [
      ip.id, ip.region.code, ip.publicIp, `$${ip.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['Allocation ID', 'Region', 'Public IP', 'Cost/mo'], rows, [175, 84, 156, 80], y);
  }

  if (summary.rdsInstances.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'RDS Instances — Stopped');
    const rows = summary.rdsInstances.map(db => [
      db.id, db.region.code, db.dbInstanceClass, db.engine,
      `${db.allocatedStorageGb} GB ${db.storageType}`, `$${db.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['Identifier', 'Region', 'Class', 'Engine', 'Storage', 'Cost/mo'], rows, [125, 72, 82, 68, 80, 68], y);
  }

  if (summary.loadBalancers.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'Load Balancers — Idle');
    const rows = summary.loadBalancers.map(lb => [
      lb.name, lb.region.code, lb.type, fmt(lb.createdTime), `$${lb.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['Name', 'Region', 'Type', 'Created', 'Cost/mo'], rows, [175, 84, 64, 90, 82], y);
  }

  if (summary.stoppedEc2Instances.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'EC2 Instances — Stopped (EBS still billed)');
    const rows = summary.stoppedEc2Instances.map(inst => [
      inst.id, inst.region.code, inst.instanceType,
      inst.attachedVolumes.length > 0
        ? inst.attachedVolumes.map(v => `${v.sizeGb}GB ${v.volumeType}`).join(', ')
        : '—',
      fmt(inst.launchTime), `$${inst.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['Instance ID', 'Region', 'Type', 'Attached volumes', 'Launched', 'Cost/mo'], rows, [110, 72, 62, 115, 80, 56], y);
  }

  if (summary.orphanSnapshots.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'EBS Snapshots — Orphaned (source volume deleted)');
    const rows = summary.orphanSnapshots.map(snap => [
      snap.id, snap.region.code, snap.sourceVolumeId, `${snap.sizeGb} GB`,
      fmt(snap.startTime), `$${snap.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['Snapshot ID', 'Region', 'Source volume', 'Size', 'Created', 'Cost/mo'], rows, [115, 72, 112, 48, 80, 68], y);
  }

  if (summary.idleNatGateways.length > 0) {
    doc.addPage();
    const y = sectionHeader(doc, 'NAT Gateways — Idle (zero traffic in last 48h)');
    const rows = summary.idleNatGateways.map(gw => [
      gw.id, gw.region.code, gw.vpcId, fmt(gw.createTime), `$${gw.costEstimate.monthlyCostUsd.toFixed(2)}/mo`,
    ]);
    drawTable(doc, ['NAT Gateway ID', 'Region', 'VPC', 'Created', 'Cost/mo'], rows, [140, 80, 152, 90, 33], y);
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
  let y = startY;

  // Header row
  doc.rect(MARGIN, y, totalW, ROW_H).fill(C.tableHeader);
  renderRow(doc, headers, colWidths, y, true);
  y += ROW_H;

  // Data rows
  for (let i = 0; i < rows.length; i++) {
    doc.rect(MARGIN, y, totalW, ROW_H).fill(i % 2 === 0 ? '#ffffff' : C.rowAlt);
    renderRow(doc, rows[i], colWidths, y, false);
    y += ROW_H;
  }

  // Outer border
  doc.rect(MARGIN, startY, totalW, (rows.length + 1) * ROW_H)
    .lineWidth(0.5).strokeColor(C.border).stroke();

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
  const wins: QuickWin[] = [
    ...summary.ebsVolumes.map(v => ({
      label: `Delete unattached EBS ${v.id} — ${v.sizeGb} GB ${v.volumeType} in ${v.region.code}`,
      monthlyCostUsd: v.costEstimate.monthlyCostUsd,
    })),
    ...summary.elasticIps.map(ip => ({
      label: `Release unassociated Elastic IP ${ip.publicIp} (${ip.id}) in ${ip.region.code}`,
      monthlyCostUsd: ip.costEstimate.monthlyCostUsd,
    })),
    ...summary.rdsInstances.map(db => ({
      label: `Terminate or snapshot stopped RDS ${db.id} (${db.dbInstanceClass} ${db.engine}) in ${db.region.code}`,
      monthlyCostUsd: db.costEstimate.monthlyCostUsd,
    })),
    ...summary.loadBalancers.map(lb => ({
      label: `Delete idle ${lb.type} Load Balancer "${lb.name}" in ${lb.region.code}`,
      monthlyCostUsd: lb.costEstimate.monthlyCostUsd,
    })),
    ...summary.stoppedEc2Instances.map(inst => ({
      label: `Terminate stopped EC2 ${inst.id} (${inst.instanceType}, ${inst.region.code}) — ${inst.attachedVolumes.length} volume(s) still billed`,
      monthlyCostUsd: inst.costEstimate.monthlyCostUsd,
    })),
    ...summary.orphanSnapshots.map(snap => ({
      label: `Delete orphan snapshot ${snap.id} (${snap.sizeGb} GB) in ${snap.region.code} — source volume deleted`,
      monthlyCostUsd: snap.costEstimate.monthlyCostUsd,
    })),
    ...summary.idleNatGateways.map(gw => ({
      label: `Delete idle NAT Gateway ${gw.id} in ${gw.region.code} — zero traffic for 48h`,
      monthlyCostUsd: gw.costEstimate.monthlyCostUsd,
    })),
  ];

  return wins.sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd).slice(0, 8);
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

function buildBreakdownRows(summary: WastedResourcesSummary): string[][] {
  const sum = (items: Array<{ costEstimate: { monthlyCostUsd: number } }>) =>
    items.reduce((t, i) => t + i.costEstimate.monthlyCostUsd, 0);

  const types = [
    { label: 'EBS Volumes (unattached)', items: summary.ebsVolumes },
    { label: 'Elastic IPs (unassociated)', items: summary.elasticIps },
    { label: 'RDS Instances (stopped)', items: summary.rdsInstances },
    { label: 'Load Balancers (idle)', items: summary.loadBalancers },
    { label: 'EC2 Instances (stopped)', items: summary.stoppedEc2Instances },
    { label: 'EBS Snapshots (orphaned)', items: summary.orphanSnapshots },
    { label: 'NAT Gateways (idle)', items: summary.idleNatGateways },
  ] as const;

  return types
    .filter(t => t.items.length > 0)
    .map(t => [t.label, String(t.items.length), `$${sum(t.items).toFixed(2)}/mo`]);
}

function allResources(summary: WastedResourcesSummary): unknown[] {
  return [
    ...summary.ebsVolumes,
    ...summary.elasticIps,
    ...summary.rdsInstances,
    ...summary.loadBalancers,
    ...summary.stoppedEc2Instances,
    ...summary.orphanSnapshots,
    ...summary.idleNatGateways,
  ];
}

function fmt(date: Date): string {
  return date.toISOString().split('T')[0];
}
