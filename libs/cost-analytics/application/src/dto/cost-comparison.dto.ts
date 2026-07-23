// SPDX-License-Identifier: Apache-2.0
import type { CostComparisonSummary, CostPeriodTotal, CostServiceDelta } from 'cost-analytics-domain';
import { REPORT_CONTACT, COST_REPORT_DISCLAIMER } from '../constants/report-disclaimer';

export interface CostAnalyticsMeta {
  accountId: string;
  generatedAt: Date;
}

export interface CostComparisonDto {
  meta: { accountId: string; generatedAt: string };
  disclaimer: string;
  contact: { email: string; linkedin: string };
  current: CostPeriodTotal;
  previous: CostPeriodTotal;
  changeUsd: number;
  changePercent: number | null;
  byService: readonly CostServiceDelta[];
}

export function toCostComparisonDto(summary: CostComparisonSummary, meta: CostAnalyticsMeta): CostComparisonDto {
  return {
    meta: { accountId: meta.accountId, generatedAt: meta.generatedAt.toISOString() },
    disclaimer: COST_REPORT_DISCLAIMER,
    contact: REPORT_CONTACT,
    current: summary.current,
    previous: summary.previous,
    changeUsd: summary.changeUsd,
    changePercent: summary.changePercent,
    byService: summary.byService,
  };
}
