// SPDX-License-Identifier: Apache-2.0
import { ValueObject } from 'shared-kernel';

interface CostEstimateProps {
  monthlyCostUsd: number;
  description: string;
}

export class CostEstimate extends ValueObject<CostEstimateProps> {
  static of(monthlyCostUsd: number, description = ''): CostEstimate {
    return new CostEstimate({ monthlyCostUsd: +monthlyCostUsd.toFixed(4), description });
  }

  get monthlyCostUsd(): number {
    return this.props.monthlyCostUsd;
  }

  get description(): string {
    return this.props.description;
  }

  format(): string {
    return `$${this.props.monthlyCostUsd.toFixed(2)}/mo`;
  }
}
