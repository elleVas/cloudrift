// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';

export interface CostByService {
  /** Cost Explorer's own service display name (e.g. "Amazon Elastic Compute Cloud - Compute"). */
  readonly service: string;
  readonly amountUsd: number;
}

export interface CostPeriodBucket {
  /** YYYY-MM-DD, inclusive. */
  readonly start: string;
  /** YYYY-MM-DD, exclusive. */
  readonly end: string;
  readonly totalUsd: number;
  readonly byService: readonly CostByService[];
  /**
   * False for the bucket covering the current, still-open billing period —
   * AWS itself marks this data as an estimate. Callers must never cache a
   * non-final bucket and should label it as provisional in any report.
   */
  readonly final: boolean;
}

export interface CostExplorerPort {
  /**
   * One bucket per granularity unit (day or month) covering
   * `[startDate, endDate)`, chronologically ordered, each broken down by
   * AWS service. This is a thin wrapper over Cost Explorer's own
   * `GetCostAndUsage` shape — callers (use-cases) compose the fair-window
   * comparison and multi-month trend from these buckets; the port itself
   * has no cloudrift-specific logic.
   */
  getCostAndUsage(params: {
    startDate: string;
    endDate: string;
    granularity: 'DAILY' | 'MONTHLY';
  }): Promise<Result<CostPeriodBucket[]>>;
}
