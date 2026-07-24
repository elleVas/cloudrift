// SPDX-License-Identifier: Apache-2.0
import type { DeadResourceSeverity, DeadResourcesSummary } from 'dead-resources-domain';
import { DEAD_RESOURCES_REPORT_DISCLAIMER } from '../constants/report-disclaimer';

/**
 * Serializable (JSON-safe) projection of the summary — mirrors
 * `cloud-cost-application`'s `WasteReportDto`. `summary.findings` holds raw
 * `DeadResource` entity instances: their data lives behind getters
 * (`private readonly props`), which `JSON.stringify` silently drops (no
 * enumerable own properties) — this DTO is the only correct way to
 * serialize a `DeadResourcesSummary` for any consumer (CLI `--format json`,
 * the MCP server, or a future HTTP API).
 */
export interface DeadResourcesReportDto {
  meta: {
    accountId: string;
    regions: string[];
    generatedAt: string;
  };
  disclaimer: string;
  countBySeverity: Record<DeadResourceSeverity, number>;
  findings: Array<{
    id: string;
    kind: string;
    region: string | null;
    accountId: string;
    detectedAt: string;
    tags: Record<string, string>;
    hygieneReason: string;
    severity: DeadResourceSeverity;
  }>;
  scanErrors: Array<{ kind: string; region: string; message: string }>;
}

export interface DeadResourcesReportMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

export function toDeadResourceReportDto(
  summary: DeadResourcesSummary,
  meta: DeadResourcesReportMeta,
): DeadResourcesReportDto {
  return {
    meta: {
      accountId: meta.accountId,
      regions: meta.regions,
      generatedAt: meta.generatedAt.toISOString(),
    },
    disclaimer: DEAD_RESOURCES_REPORT_DISCLAIMER,
    countBySeverity: summary.countBySeverity,
    findings: summary.findings.map((f) => ({
      id: f.id,
      kind: f.kind,
      // undefined (global AWS services, e.g. IAM — no region) becomes `null` in JSON, not an omitted key.
      region: f.region?.code ?? null,
      accountId: f.accountId,
      detectedAt: f.detectedAt.toISOString(),
      tags: f.tags,
      hygieneReason: f.hygieneReason,
      severity: f.severity,
    })),
    scanErrors: summary.scanErrors.map((e) => ({ kind: e.kind, region: e.region, message: e.error.message })),
  };
}
