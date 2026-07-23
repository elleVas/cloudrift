// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySummary } from 'resource-security-domain';

export interface ResourceSecurityReportMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

/** No DTO builder yet (mirrors `dead-resources-report.json-formatter.ts`) — a single flat `findings[]` is enough for now. */
export function formatResourceSecurityReportAsJson(summary: ResourceSecuritySummary, meta: ResourceSecurityReportMeta): string {
  return JSON.stringify(
    {
      meta: {
        accountId: meta.accountId,
        regions: meta.regions,
        generatedAt: meta.generatedAt.toISOString(),
      },
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
      scanErrors: summary.scanErrors.map((e) => ({ kind: e.kind, region: e.region, error: e.error.message })),
    },
    null,
    2,
  );
}
