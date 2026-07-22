// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_KIND_META, groupByKind } from 'cloud-cost-domain';
import type {
  FindingCategory,
  ResourceKind,
  WastedResource,
  WastedResourcesSummary,
  Workspace,
} from 'cloud-cost-domain';
import { REPORT_CONTACT, REPORT_DISCLAIMER } from '../constants/report-disclaimer';

/**
 * Serializable (JSON-safe) projection of the summary: it's the data contract
 * for any presentation — CLI, PDF, HTTP API, or frontend. It contains no
 * classes or Dates: only primitives and ISO strings.
 *
 * Findings are split into two categories: `waste` (waste, counts toward the
 * waste total / CI gate) and `optimization` (savings opportunity, separate). The
 * `estimated` entries are estimates (rightsizing) to be verified.
 */
export interface WasteReportDto {
  meta: {
    accountId: string;
    regions: string[];
    generatedAt: string;
    pricesAsOf: string;
  };
  disclaimer: string;
  contact: { email: string; linkedin: string };
  totalWasteMonthlyUsd: number;
  totalWasteAnnualUsd: number;
  totalOptimizationMonthlyUsd: number;
  wasteCount: number;
  optimizationCount: number;
  breakdown: Array<{
    kind: ResourceKind;
    label: string;
    category: FindingCategory;
    estimated: boolean;
    count: number;
    monthlyCostUsd: number;
  }>;
  findings: Array<{
    id: string;
    kind: ResourceKind;
    category: FindingCategory;
    estimated: boolean;
    region: string;
    accountId: string;
    detectedAt: string;
    wasteReason: string;
    description: string;
    monthlyCostUsd: number;
    tags: Record<string, string>;
    /** Only set for `workspaces-idle` findings — the WorkSpace's assigned user. */
    userName?: string;
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
      label: RESOURCE_KIND_META[kind].label,
      category: RESOURCE_KIND_META[kind].category,
      estimated: RESOURCE_KIND_META[kind].estimated,
      count: grouped[kind].length,
      monthlyCostUsd: round2(
        grouped[kind].reduce((sum, r) => sum + r.costEstimate.monthlyCostUsd, 0),
      ),
    }));

  let wasteCount = 0;
  let optimizationCount = 0;
  for (const finding of summary.findings) {
    if (RESOURCE_KIND_META[finding.kind].category === 'waste') wasteCount++;
    else optimizationCount++;
  }

  return {
    meta: {
      accountId: meta.accountId,
      regions: meta.regions,
      generatedAt: meta.generatedAt.toISOString(),
      pricesAsOf: meta.pricesAsOf,
    },
    disclaimer: REPORT_DISCLAIMER,
    contact: REPORT_CONTACT,
    totalWasteMonthlyUsd: round2(summary.totalWasteMonthlyUsd),
    totalWasteAnnualUsd: round2(summary.totalWasteMonthlyUsd * 12),
    totalOptimizationMonthlyUsd: round2(summary.totalOptimizationMonthlyUsd),
    wasteCount,
    optimizationCount,
    breakdown,
    findings: summary.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      category: RESOURCE_KIND_META[finding.kind].category,
      estimated: RESOURCE_KIND_META[finding.kind].estimated,
      region: finding.region.code,
      accountId: finding.accountId,
      detectedAt: finding.detectedAt.toISOString(),
      wasteReason: finding.wasteReason,
      description: finding.costEstimate.description,
      monthlyCostUsd: finding.costEstimate.monthlyCostUsd,
      tags: finding.tags,
      ...(isWorkspace(finding) ? { userName: finding.userName } : {}),
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

function isWorkspace(finding: WastedResource): finding is Workspace {
  return finding.kind === 'workspaces-idle';
}
