// SPDX-License-Identifier: Apache-2.0
import { toCostTrendDto } from 'cost-analytics-application';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import type { CostTrendSummary } from 'cost-analytics-domain';
import { toCsv } from './csv-utils';

const HEADERS = ['month', 'totalUsd', 'final'];

/** One row per month. */
export function formatCostTrendAsCsv(summary: CostTrendSummary, meta: CostAnalyticsMeta): string {
  const dto = toCostTrendDto(summary, meta);
  const rows = dto.months.map((month) => [month.month, month.totalUsd, month.final]);
  return toCsv(HEADERS, rows);
}
