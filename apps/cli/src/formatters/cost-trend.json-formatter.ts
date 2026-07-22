// SPDX-License-Identifier: Apache-2.0
import { toCostTrendDto } from 'cloud-cost-application';
import type { CostAnalyticsMeta } from 'cloud-cost-application';
import type { CostTrendSummary } from 'cloud-cost-domain';

export function formatCostTrendAsJson(summary: CostTrendSummary, meta: CostAnalyticsMeta): string {
  return JSON.stringify(toCostTrendDto(summary, meta), null, 2);
}
