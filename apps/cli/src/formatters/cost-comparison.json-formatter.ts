// SPDX-License-Identifier: Apache-2.0
import { toCostComparisonDto } from 'cost-analytics-application';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import type { CostComparisonSummary } from 'cost-analytics-domain';

export function formatCostComparisonAsJson(summary: CostComparisonSummary, meta: CostAnalyticsMeta): string {
  return JSON.stringify(toCostComparisonDto(summary, meta), null, 2);
}
