// SPDX-License-Identifier: Apache-2.0
import { toCostTrendDto } from 'cost-analytics-application';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import type { CostTrendSummary } from 'cost-analytics-domain';

export function formatCostTrendAsJson(summary: CostTrendSummary, meta: CostAnalyticsMeta): string {
  return JSON.stringify(toCostTrendDto(summary, meta), null, 2);
}
