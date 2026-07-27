// SPDX-License-Identifier: Apache-2.0
import { toCostComparisonDto } from 'cost-analytics-application';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import type { CostComparisonSummary } from 'cost-analytics-domain';
import { toCsv } from './csv-utils';

const HEADERS = ['service', 'currentUsd', 'previousUsd', 'changeUsd', 'changePercent'];

/** One row per service delta — current/previous period totals live in `meta`/table output, not repeated per row here. */
export function formatCostComparisonAsCsv(summary: CostComparisonSummary, meta: CostAnalyticsMeta): string {
  const dto = toCostComparisonDto(summary, meta);
  const rows = dto.byService.map((delta) => [
    delta.service,
    delta.currentUsd,
    delta.previousUsd,
    delta.changeUsd,
    delta.changePercent,
  ]);
  return toCsv(HEADERS, rows);
}
