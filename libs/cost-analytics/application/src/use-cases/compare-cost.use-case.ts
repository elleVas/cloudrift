// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type {
  CompareCostRequest,
  CompareCostUseCasePort,
  CostComparisonSummary,
  CostExplorerPort,
  CostPeriodBucket,
  CostServiceDelta,
} from 'cost-analytics-domain';
import { addDaysUTC, round2, startOfDayUTC, startOfMonthUTC, toYmd } from '../utils/date-window';

/**
 * Compares spend for "the 1st through today" against the same day-of-month
 * range in the previous month, instead of the naive "month-so-far vs the
 * previous FULL month" — an early-month run would otherwise always look
 * like a big saving purely because the comparison side has more days in it.
 */
export class CompareCostUseCase implements CompareCostUseCasePort {
  constructor(private readonly costExplorer: CostExplorerPort) {}

  async execute(request: CompareCostRequest): Promise<Result<CostComparisonSummary>> {
    const today = request.today ?? new Date();
    const currentStart = startOfMonthUTC(today);
    const currentEnd = addDaysUTC(startOfDayUTC(today), 1);

    const previousMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const dayOfMonth = today.getUTCDate();
    const candidatePreviousEnd = addDaysUTC(previousMonthStart, dayOfMonth);
    // Clipped so a short previous month (e.g. comparing March 31st against
    // February) never spills days into the current month's own range —
    // the previous period simply ends up shorter than `dayOfMonth` days.
    const previousEnd = candidatePreviousEnd < currentStart ? candidatePreviousEnd : currentStart;

    const result = await this.costExplorer.getCostAndUsage({
      startDate: toYmd(previousMonthStart),
      endDate: toYmd(currentEnd),
      granularity: 'DAILY',
    });
    if (!result.ok) return result;

    const previous = sumBuckets(result.value, toYmd(previousMonthStart), toYmd(previousEnd));
    const current = sumBuckets(result.value, toYmd(currentStart), toYmd(currentEnd));

    // Rounded first, then diffed: changePercent must agree with the totals
    // actually shown to the user. Deriving it from the raw (unrounded) sums
    // instead let a sub-cent previous-period total that *displays* as
    // "$0.00" still act as a non-zero denominator, producing a nonsensical
    // multi-million-percent "increase" instead of the "n/a" a $0.00 baseline
    // should show.
    const currentTotal = round2(current.totalUsd);
    const previousTotal = round2(previous.totalUsd);
    const changeUsd = round2(currentTotal - previousTotal);
    const changePercent = previousTotal === 0 ? null : (changeUsd / previousTotal) * 100;

    return Result.ok({
      current: { start: toYmd(currentStart), end: toYmd(currentEnd), totalUsd: currentTotal },
      previous: {
        start: toYmd(previousMonthStart),
        end: toYmd(previousEnd),
        totalUsd: previousTotal,
      },
      changeUsd,
      changePercent,
      byService: buildServiceDeltas(current.byService, previous.byService),
    });
  }
}

function sumBuckets(
  buckets: readonly CostPeriodBucket[],
  fromInclusive: string,
  toExclusive: string,
): { totalUsd: number; byService: Map<string, number> } {
  const byService = new Map<string, number>();
  let totalUsd = 0;
  for (const bucket of buckets) {
    if (bucket.start < fromInclusive || bucket.start >= toExclusive) continue;
    totalUsd += bucket.totalUsd;
    for (const { service, amountUsd } of bucket.byService) {
      byService.set(service, (byService.get(service) ?? 0) + amountUsd);
    }
  }
  return { totalUsd, byService };
}

function buildServiceDeltas(current: Map<string, number>, previous: Map<string, number>): CostServiceDelta[] {
  const services = new Set([...current.keys(), ...previous.keys()]);
  const deltas: CostServiceDelta[] = [];
  for (const service of services) {
    const currentUsd = round2(current.get(service) ?? 0);
    const previousUsd = round2(previous.get(service) ?? 0);
    const changeUsd = round2(currentUsd - previousUsd);
    deltas.push({
      service,
      currentUsd,
      previousUsd,
      changeUsd,
      changePercent: previousUsd === 0 ? null : (changeUsd / previousUsd) * 100,
    });
  }
  return deltas.sort((a, b) => Math.abs(b.changeUsd) - Math.abs(a.changeUsd));
}
