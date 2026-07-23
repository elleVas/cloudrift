// SPDX-License-Identifier: Apache-2.0

export interface CostTrendMonth {
  /** YYYY-MM. */
  readonly month: string;
  readonly totalUsd: number;
  /** False for the current, still-open month — AWS marks this data as an estimate. */
  readonly final: boolean;
}

export interface CostTrendSummary {
  /** Chronological, oldest first. */
  readonly months: readonly CostTrendMonth[];
  /** Cost Explorer service names the totals were filtered to, if any. */
  readonly filteredServices?: readonly string[];
}
