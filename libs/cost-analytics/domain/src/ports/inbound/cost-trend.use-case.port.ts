// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { CostTrendSummary } from '../../cost-trend';

export interface CostTrendRequest {
  /** Number of calendar months, including the current partial one. Default 6. */
  readonly months?: number;
  /** Cost Explorer service names to restrict the totals to. Default: every service. */
  readonly services?: readonly string[];
  /** Injectable for tests; defaults to `new Date()`. */
  readonly today?: Date;
}

export interface CostTrendUseCasePort {
  execute(request: CostTrendRequest): Promise<Result<CostTrendSummary>>;
}
