// SPDX-License-Identifier: Apache-2.0

/**
 * Past this many days since `pricesAsOf`, the report flags the estimate as stale.
 * Set above the ~90-day quarterly built-in price refresh cadence (see the
 * `cloudrift: monthly AWS pricing refresh` routines) so the warning only fires
 * when a refresh cycle is actually late, not during the normal gap between them.
 */
export const PRICES_STALE_AFTER_DAYS = 100;

const YEAR_MONTH = /^(\d{4})-(\d{2})/;

/**
 * `pricesAsOf` is a "YYYY-MM" tag (see `prices.json`), optionally suffixed
 * with " + custom overrides" once user overrides are layered on top (see
 * `pricing.factory.ts`) — judge staleness against the leading year-month only.
 * Live-pricing runs set `pricesAsOf` to the current month, so this is always
 * `false` for them by construction.
 */
export function isPricesStale(pricesAsOf: string, generatedAt: Date): boolean {
  const match = YEAR_MONTH.exec(pricesAsOf);
  if (!match) return false;
  const [, year, month] = match;
  const asOfDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const ageDays = (generatedAt.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > PRICES_STALE_AFTER_DAYS;
}
