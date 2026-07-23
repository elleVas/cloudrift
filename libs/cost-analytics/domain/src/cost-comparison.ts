// SPDX-License-Identifier: Apache-2.0

export interface CostServiceDelta {
  readonly service: string;
  readonly currentUsd: number;
  readonly previousUsd: number;
  readonly changeUsd: number;
  /** null when the previous period was $0 for this service (percent change is undefined). */
  readonly changePercent: number | null;
}

export interface CostPeriodTotal {
  /** YYYY-MM-DD, inclusive. */
  readonly start: string;
  /** YYYY-MM-DD, exclusive. */
  readonly end: string;
  readonly totalUsd: number;
}

/**
 * Current-vs-previous-period spend comparison, using identical day-of-month
 * windows on both sides (e.g. the 1st-15th of this month vs the 1st-15th of
 * last month) so an early-month run never looks like a "saving" purely
 * because the previous period being compared against is a full month.
 */
export interface CostComparisonSummary {
  readonly current: CostPeriodTotal;
  readonly previous: CostPeriodTotal;
  readonly changeUsd: number;
  readonly changePercent: number | null;
  /** Sorted by |changeUsd| descending — biggest movers first. */
  readonly byService: readonly CostServiceDelta[];
}
