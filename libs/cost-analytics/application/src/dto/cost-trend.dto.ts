// SPDX-License-Identifier: Apache-2.0
import type { CostTrendMonth, CostTrendSummary } from 'cost-analytics-domain';
import { REPORT_CONTACT, COST_REPORT_DISCLAIMER } from '../constants/report-disclaimer';
import type { CostAnalyticsMeta } from './cost-comparison.dto';

export interface CostTrendDto {
  meta: { accountId: string; generatedAt: string };
  disclaimer: string;
  contact: { email: string; linkedin: string };
  months: readonly CostTrendMonth[];
  filteredServices?: readonly string[];
}

export function toCostTrendDto(summary: CostTrendSummary, meta: CostAnalyticsMeta): CostTrendDto {
  return {
    meta: { accountId: meta.accountId, generatedAt: meta.generatedAt.toISOString() },
    disclaimer: COST_REPORT_DISCLAIMER,
    contact: REPORT_CONTACT,
    months: summary.months,
    filteredServices: summary.filteredServices,
  };
}
