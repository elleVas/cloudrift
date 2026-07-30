// SPDX-License-Identifier: Apache-2.0
import Table from 'cli-table3';
import chalk from 'chalk';
import type { TrendSnapshotRecord } from 'shared-trend-store';

interface SnapshotSummary {
  count: number;
  monthlyWasteUsd?: number;
}

/**
 * The stored payload is each domain's exact `--format json` DTO (see
 * `persistTrendSnapshot` call sites) — parsed loosely here rather than typed
 * against all three domain DTOs, since this formatter only ever needs one
 * count and one optional dollar figure out of it.
 */
function summarize(record: TrendSnapshotRecord): SnapshotSummary {
  try {
    const dto = JSON.parse(record.payload) as {
      findings?: unknown[];
      wasteCount?: number;
      optimizationCount?: number;
      totalWasteMonthlyUsd?: number;
    };
    if (record.domain === 'cloud-cost') {
      return {
        count: (dto.wasteCount ?? 0) + (dto.optimizationCount ?? 0),
        monthlyWasteUsd: dto.totalWasteMonthlyUsd,
      };
    }
    return { count: dto.findings?.length ?? 0 };
  } catch {
    return { count: 0 };
  }
}

export function formatTrendHistoryAsTable(records: TrendSnapshotRecord[]): string {
  if (records.length === 0) {
    return chalk.dim(
      '  No trend history yet for this account — run analyze / dead-resources / resource-security at least once to start building it.',
    );
  }

  const table = new Table({
    head: ['Date', 'Domain', 'Findings', 'Monthly waste'],
    style: { head: ['cyan'] },
  });

  for (const record of records) {
    const { count, monthlyWasteUsd } = summarize(record);
    table.push([
      record.generatedAt.split('T')[0],
      record.domain,
      String(count),
      monthlyWasteUsd !== undefined ? `$${monthlyWasteUsd.toFixed(2)}` : '—',
    ]);
  }

  return table.toString();
}
