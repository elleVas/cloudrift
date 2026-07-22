// SPDX-License-Identifier: Apache-2.0

/** All cost-analytics date arithmetic is done in UTC to keep it deterministic across runner timezones. */

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** YYYY-MM-DD, the format Cost Explorer's `TimePeriod` and every `CostPeriodBucket.start`/`end` use. */
export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function round2(value: number): number {
  return +value.toFixed(2);
}
