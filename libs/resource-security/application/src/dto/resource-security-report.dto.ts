// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySeverity, ResourceSecuritySummary } from 'resource-security-domain';
import { RESOURCE_SECURITY_REPORT_DISCLAIMER } from '../constants/report-disclaimer';

/**
 * Serializable (JSON-safe) projection of the summary — mirrors
 * `cloud-cost-application`'s `WasteReportDto`/`dead-resources-application`'s
 * `DeadResourcesReportDto`. `summary.findings` holds raw `SecurityFinding`
 * entity instances: their data lives behind getters (`private readonly
 * props`), which `JSON.stringify` silently drops (no enumerable own
 * properties) — this DTO is the only correct way to serialize a
 * `ResourceSecuritySummary` for any consumer (CLI `--format json`, the MCP
 * server, or a future HTTP API).
 */
export interface ResourceSecurityReportDto {
  meta: {
    accountId: string;
    regions: string[];
    generatedAt: string;
  };
  disclaimer: string;
  countBySeverity: Record<ResourceSecuritySeverity, number>;
  findings: Array<{
    id: string;
    kind: string;
    region: string | null;
    accountId: string;
    detectedAt: string;
    tags: Record<string, string>;
    riskReason: string;
    severity: ResourceSecuritySeverity;
  }>;
  scanErrors: Array<{ kind: string; region: string; message: string }>;
}

export interface ResourceSecurityReportMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

export function toResourceSecurityReportDto(
  summary: ResourceSecuritySummary,
  meta: ResourceSecurityReportMeta,
): ResourceSecurityReportDto {
  return {
    meta: {
      accountId: meta.accountId,
      regions: meta.regions,
      generatedAt: meta.generatedAt.toISOString(),
    },
    disclaimer: RESOURCE_SECURITY_REPORT_DISCLAIMER,
    countBySeverity: summary.countBySeverity,
    findings: summary.findings.map((f) => ({
      id: f.id,
      kind: f.kind,
      // undefined (account-wide/global-scope kinds — no region) becomes `null` in JSON, not an omitted key.
      region: f.region?.code ?? null,
      accountId: f.accountId,
      detectedAt: f.detectedAt.toISOString(),
      tags: f.tags,
      riskReason: f.riskReason,
      severity: f.severity,
    })),
    scanErrors: summary.scanErrors.map((e) => ({ kind: e.kind, region: e.region, message: e.error.message })),
  };
}
