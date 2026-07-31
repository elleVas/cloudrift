// SPDX-License-Identifier: Apache-2.0

/**
 * A scan-domain report is worth notifying about only once it has at least
 * one `critical` or `warning` finding — a clean run (or one with only
 * `info`-level noise) doesn't page anyone. Not applicable to `history`
 * comparisons, which use `hasRegressed` below instead (a comparison can
 * still be "worth notifying" on a worsening trend even if the absolute
 * counts aren't new).
 */
export function shouldNotifyOnSeverity(countBySeverity: { critical: number; warning: number }): boolean {
  return countBySeverity.critical > 0 || countBySeverity.warning > 0;
}

/**
 * A `history --compare` run is worth notifying about only when something got
 * worse since the previous snapshot — not merely "there's still a critical
 * finding," which would fire every single scheduled run for as long as that
 * finding stays unresolved. `newFindingsCount` covers `dead-resources`/
 * `resource-security` (any newly-appeared finding is a regression); `deltaUsd`
 * covers `cloud-cost` (spend went up).
 */
export function hasRegressed(delta: { newFindingsCount: number; deltaUsd?: number }): boolean {
  return delta.newFindingsCount > 0 || (delta.deltaUsd ?? 0) > 0;
}

/**
 * `analyze` (cost-waste) has no severity concept (ADR: dollar total + category
 * split, not info/warning/critical) — reuses the existing cost-alert-threshold
 * config instead: notify once waste exceeds it, same threshold `applyCostGate`
 * already gates CI exit codes on. With no threshold configured, any waste at
 * all is worth a notification (there's no other signal to gate on).
 */
export function shouldNotifyOnCost(totalWasteMonthlyUsd: number, costAlertThresholdUsd?: number): boolean {
  return costAlertThresholdUsd !== undefined ? totalWasteMonthlyUsd > costAlertThresholdUsd : totalWasteMonthlyUsd > 0;
}
