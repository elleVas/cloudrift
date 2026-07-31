// SPDX-License-Identifier: Apache-2.0
import { shouldNotifyOnSeverity, hasRegressed, shouldNotifyOnCost } from './should-notify';

describe('shouldNotifyOnSeverity', () => {
  it('is false when there are no critical or warning findings', () => {
    expect(shouldNotifyOnSeverity({ critical: 0, warning: 0 })).toBe(false);
  });

  it('is true when there is at least one critical finding', () => {
    expect(shouldNotifyOnSeverity({ critical: 1, warning: 0 })).toBe(true);
  });

  it('is true when there is at least one warning finding', () => {
    expect(shouldNotifyOnSeverity({ critical: 0, warning: 1 })).toBe(true);
  });
});

describe('hasRegressed', () => {
  it('is false when nothing new and no cost delta', () => {
    expect(hasRegressed({ newFindingsCount: 0 })).toBe(false);
    expect(hasRegressed({ newFindingsCount: 0, deltaUsd: 0 })).toBe(false);
  });

  it('is true when there are new findings', () => {
    expect(hasRegressed({ newFindingsCount: 1 })).toBe(true);
  });

  it('is true when the cost delta is positive', () => {
    expect(hasRegressed({ newFindingsCount: 0, deltaUsd: 12.5 })).toBe(true);
  });

  it('is false when the cost delta is negative (spend went down)', () => {
    expect(hasRegressed({ newFindingsCount: 0, deltaUsd: -12.5 })).toBe(false);
  });
});

describe('shouldNotifyOnCost', () => {
  it('is false when there is no waste and no threshold configured', () => {
    expect(shouldNotifyOnCost(0)).toBe(false);
  });

  it('is true when there is any waste and no threshold configured', () => {
    expect(shouldNotifyOnCost(0.01)).toBe(true);
  });

  it('is false when waste is under the configured threshold', () => {
    expect(shouldNotifyOnCost(50, 100)).toBe(false);
  });

  it('is true when waste exceeds the configured threshold', () => {
    expect(shouldNotifyOnCost(150, 100)).toBe(true);
  });

  it('is false when waste equals the threshold exactly', () => {
    expect(shouldNotifyOnCost(100, 100)).toBe(false);
  });
});
