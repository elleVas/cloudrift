// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { CostComparisonSummary } from '../../cost-comparison';

export interface CompareCostRequest {
  /** Injectable for tests; defaults to `new Date()`. */
  readonly today?: Date;
}

export interface CompareCostUseCasePort {
  execute(request: CompareCostRequest): Promise<Result<CostComparisonSummary>>;
}
