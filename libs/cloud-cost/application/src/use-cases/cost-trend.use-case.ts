// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type {
  CostExplorerPort,
  CostTrendMonth,
  CostTrendRequest,
  CostTrendSummary,
  CostTrendUseCasePort,
} from 'cloud-cost-domain';
import { addDaysUTC, round2, startOfDayUTC, toYmd } from '../utils/date-window';

const DEFAULT_MONTHS = 6;

export class CostTrendUseCase implements CostTrendUseCasePort {
  constructor(private readonly costExplorer: CostExplorerPort) {}

  async execute(request: CostTrendRequest): Promise<Result<CostTrendSummary>> {
    const months = request.months ?? DEFAULT_MONTHS;
    const today = request.today ?? new Date();
    const rangeStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1));
    const rangeEnd = addDaysUTC(startOfDayUTC(today), 1);

    const result = await this.costExplorer.getCostAndUsage({
      startDate: toYmd(rangeStart),
      endDate: toYmd(rangeEnd),
      granularity: 'MONTHLY',
    });
    if (!result.ok) return result;

    const serviceFilter = request.services ? new Set(request.services) : undefined;
    const monthsOut: CostTrendMonth[] = result.value.map((bucket) => ({
      month: bucket.start.slice(0, 7),
      totalUsd: round2(
        serviceFilter
          ? bucket.byService
              .filter((s) => serviceFilter.has(s.service))
              .reduce((sum, s) => sum + s.amountUsd, 0)
          : bucket.totalUsd,
      ),
      final: bucket.final,
    }));

    return Result.ok({
      months: monthsOut,
      filteredServices: request.services,
    });
  }
}
