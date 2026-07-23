// SPDX-License-Identifier: Apache-2.0
import type { DeadResourcesSummary } from 'dead-resources-domain';

export interface DeadResourcesReportMeta {
  accountId: string;
  regions: string[];
  generatedAt: Date;
}

/**
 * No DTO builder like `toWasteReportDto` yet (ADR-0078) — a single flat
 * `findings[]` is enough for one kind. Add one (mirroring
 * `cloud-cost-application`'s `dto/`) if/when this needs a stable, versioned
 * wire contract independent of the domain entities.
 */
export function formatDeadResourcesReportAsJson(summary: DeadResourcesSummary, meta: DeadResourcesReportMeta): string {
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
        // undefined (global AWS services, e.g. IAM — no region) becomes `null` in JSON, not an omitted key.
        region: f.region?.code ?? null,
        accountId: f.accountId,
        detectedAt: f.detectedAt.toISOString(),
        tags: f.tags,
        hygieneReason: f.hygieneReason,
        severity: f.severity,
      })),
      scanErrors: summary.scanErrors.map((e) => ({ kind: e.kind, region: e.region, error: e.error.message })),
    },
    null,
    2,
  );
}
