// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySummary } from 'resource-security-domain';
import { toResourceSecurityReportDto, type ResourceSecurityReportMeta } from 'resource-security-application';
import { buildConsoleUrl } from '../aws-console-link';
import { toCsv } from './csv-utils';

const HEADERS = ['id', 'kind', 'region', 'accountId', 'detectedAt', 'tags', 'riskReason', 'severity', 'consoleUrl'];

/** One row per finding, raw DTO fields — meant for re-processing (spreadsheets, scripts), not on-screen reading. */
export function formatResourceSecurityReportAsCsv(
  summary: ResourceSecuritySummary,
  meta: ResourceSecurityReportMeta,
): string {
  const dto = toResourceSecurityReportDto(summary, meta);
  const rows = dto.findings.map((finding) => [
    finding.id,
    finding.kind,
    finding.region,
    finding.accountId,
    finding.detectedAt,
    JSON.stringify(finding.tags),
    finding.riskReason,
    finding.severity,
    buildConsoleUrl({ ...finding, region: finding.region ?? undefined }),
  ]);
  return toCsv(HEADERS, rows);
}
