// SPDX-License-Identifier: Apache-2.0
import { CostEstimate } from './cost-estimate.value-object';

describe('CostEstimate', () => {
  describe('of', () => {
    it('stores the monthly cost rounded to 4 decimal places', () => {
      const estimate = CostEstimate.of(8.00001);
      expect(estimate.monthlyCostUsd).toBe(8.0);
    });

    it('stores an optional description', () => {
      const estimate = CostEstimate.of(3.6, 'Unassociated Elastic IP');
      expect(estimate.description).toBe('Unassociated Elastic IP');
    });

    it('defaults description to empty string', () => {
      const estimate = CostEstimate.of(10);
      expect(estimate.description).toBe('');
    });

    it('formats cost as currency string', () => {
      const estimate = CostEstimate.of(8);
      expect(estimate.format()).toBe('$8.00/mo');
    });

    it('formats fractional cost correctly', () => {
      const estimate = CostEstimate.of(3.6);
      expect(estimate.format()).toBe('$3.60/mo');
    });
  });

  describe('equals', () => {
    it('returns true for identical estimates', () => {
      const a = CostEstimate.of(8, 'EBS');
      const b = CostEstimate.of(8, 'EBS');
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when cost differs', () => {
      const a = CostEstimate.of(8);
      const b = CostEstimate.of(16);
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when description differs', () => {
      const a = CostEstimate.of(8, 'gp3');
      const b = CostEstimate.of(8, 'gp2');
      expect(a.equals(b)).toBe(false);
    });
  });
});
