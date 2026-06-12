import { RESOURCE_KIND_LABELS, groupByKind } from 'cloud-cost-domain';
import type { ResourceKind, WastedResourcesSummary } from 'cloud-cost-domain';

/**
 * Proiezione serializzabile (JSON-safe) del summary: è il contratto dati
 * per qualunque presentazione — CLI, PDF, API HTTP o frontend. Non contiene
 * classi né Date: solo primitivi e stringhe ISO.
 */
export interface WasteReportDto {
  meta: {
    accountId: string;
    regions: string[];
    generatedAt: string;
    pricesAsOf: string;
  };
  totalMonthlyCostUsd: number;
  totalAnnualCostUsd: number;
  resourceCount: number;
  breakdown: Array<{
    kind: ResourceKind;
    label: string;
    count: number;
    monthlyCostUsd: number;
  }>;
  findings: Array<{
    id: string;
    kind: ResourceKind;
    region: string;
    accountId: string;
    detectedAt: string;
    wasteReason: string;
    description: string;
    monthlyCostUsd: number;
    tags: Record<string, string>;
  }>;
  scanErrors: Array<{
    kind: ResourceKind;
    region: string;
    message: string;
  }>;
}

export interface WasteReportMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
  pricesAsOf: string;
}

export function toWasteReportDto(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
): WasteReportDto {
  const grouped = groupByKind(summary.findings);

  const breakdown = (Object.keys(grouped) as ResourceKind[])
    .filter((kind) => grouped[kind].length > 0)
    .map((kind) => ({
      kind,
      label: RESOURCE_KIND_LABELS[kind],
      count: grouped[kind].length,
      monthlyCostUsd: round2(
        grouped[kind].reduce((sum, r) => sum + r.costEstimate.monthlyCostUsd, 0),
      ),
    }));

  return {
    meta: {
      accountId: meta.accountId,
      regions: meta.regions,
      generatedAt: meta.generatedAt.toISOString(),
      pricesAsOf: meta.pricesAsOf,
    },
    totalMonthlyCostUsd: round2(summary.totalMonthlyCostUsd),
    totalAnnualCostUsd: round2(summary.totalMonthlyCostUsd * 12),
    resourceCount: summary.findings.length,
    breakdown,
    findings: summary.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      region: finding.region.code,
      accountId: finding.accountId,
      detectedAt: finding.detectedAt.toISOString(),
      wasteReason: finding.wasteReason,
      description: finding.costEstimate.description,
      monthlyCostUsd: finding.costEstimate.monthlyCostUsd,
      tags: finding.tags,
    })),
    scanErrors: summary.scanErrors.map(({ kind, region, error }) => ({
      kind,
      region,
      message: error.message,
    })),
  };
}

function round2(value: number): number {
  return +value.toFixed(2);
}
