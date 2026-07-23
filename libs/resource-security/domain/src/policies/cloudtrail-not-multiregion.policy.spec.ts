// SPDX-License-Identifier: Apache-2.0
import { CloudtrailNotMultiregion } from '../entities/cloudtrail-not-multiregion.entity';
import type { CloudtrailNotMultiregionProps } from '../entities/cloudtrail-not-multiregion.entity';
import { CloudtrailNotMultiregionPolicy } from './cloudtrail-not-multiregion.policy';

function makeFinding(overrides: Partial<CloudtrailNotMultiregionProps> = {}): CloudtrailNotMultiregion {
  return new CloudtrailNotMultiregion({
    accountId: '123456789012',
    hasMultiRegionTrail: false,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('CloudtrailNotMultiregionPolicy', () => {
  const policy = new CloudtrailNotMultiregionPolicy();

  it('flags when no multi-region trail exists', () => {
    expect(policy.evaluate(makeFinding({ hasMultiRegionTrail: false })).flagged).toBe(true);
  });

  it('does not flag when a multi-region trail exists', () => {
    expect(policy.evaluate(makeFinding({ hasMultiRegionTrail: true })).flagged).toBe(false);
  });
});
