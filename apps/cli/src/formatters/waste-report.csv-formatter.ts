// SPDX-License-Identifier: Apache-2.0
import { toWasteReportDto } from 'cloud-cost-application';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import { buildConsoleUrl } from '../aws-console-link';
import { toCsv } from './csv-utils';

const HEADERS = [
  'id',
  'kind',
  'category',
  'estimated',
  'region',
  'accountId',
  'detectedAt',
  'wasteReason',
  'description',
  'monthlyCostUsd',
  'tags',
  'userName',
  'consoleUrl',
  'pricesAsOf',
  'pricesStale',
];

/**
 * One row per finding, raw DTO fields — meant for re-processing (spreadsheets, scripts), not
 * on-screen reading. `pricesAsOf`/`pricesStale` repeat the report-level meta on every row (same
 * pattern as `accountId`) so a script consuming just this CSV can still judge estimate freshness.
 */
export function formatWasteReportAsCsv(summary: WastedResourcesSummary, meta: WasteReportMeta): string {
  const dto = toWasteReportDto(summary, meta);
  const rows = dto.findings.map((finding) => [
    finding.id,
    finding.kind,
    finding.category,
    finding.estimated,
    finding.region,
    finding.accountId,
    finding.detectedAt,
    finding.wasteReason,
    finding.description,
    finding.monthlyCostUsd,
    JSON.stringify(finding.tags),
    finding.userName,
    buildConsoleUrl(finding),
    dto.meta.pricesAsOf,
    dto.meta.pricesStale,
  ]);
  return toCsv(HEADERS, rows);
}
