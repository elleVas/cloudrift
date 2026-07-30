// SPDX-License-Identifier: Apache-2.0
import type { HistoryComparison } from '../commands/history-comparison';

export function formatHistoryComparisonAsJson(comparison: HistoryComparison): string {
  return JSON.stringify(comparison, null, 2);
}
