// SPDX-License-Identifier: Apache-2.0
import { toCostComparisonDto } from 'cloud-cost-application';
import type { CostAnalyticsMeta } from 'cloud-cost-application';
import type { CostComparisonSummary } from 'cloud-cost-domain';

export function formatCostComparisonAsJson(summary: CostComparisonSummary, meta: CostAnalyticsMeta): string {
  return JSON.stringify(toCostComparisonDto(summary, meta), null, 2);
}
