// SPDX-License-Identifier: Apache-2.0
import type { DeadResourcesSummary } from 'dead-resources-domain';
import { toDeadResourceReportDto, type DeadResourcesReportMeta } from 'dead-resources-application';
import { buildConsoleUrl } from '../aws-console-link';
import { toCsv } from './csv-utils';

const HEADERS = ['id', 'kind', 'region', 'accountId', 'detectedAt', 'tags', 'hygieneReason', 'severity', 'consoleUrl'];

/** One row per finding, raw DTO fields — meant for re-processing (spreadsheets, scripts), not on-screen reading. */
export function formatDeadResourcesReportAsCsv(summary: DeadResourcesSummary, meta: DeadResourcesReportMeta): string {
  const dto = toDeadResourceReportDto(summary, meta);
  const rows = dto.findings.map((finding) => [
    finding.id,
    finding.kind,
    finding.region,
    finding.accountId,
    finding.detectedAt,
    JSON.stringify(finding.tags),
    finding.hygieneReason,
    finding.severity,
    buildConsoleUrl({ ...finding, region: finding.region ?? undefined }),
  ]);
  return toCsv(HEADERS, rows);
}
