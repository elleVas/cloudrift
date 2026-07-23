// SPDX-License-Identifier: Apache-2.0
import { CloudtrailNotMultiregion } from './cloudtrail-not-multiregion.entity';
import type { CloudtrailNotMultiregionProps } from './cloudtrail-not-multiregion.entity';

function makeFinding(overrides: Partial<CloudtrailNotMultiregionProps> = {}): CloudtrailNotMultiregion {
  return new CloudtrailNotMultiregion({
    accountId: '123456789012',
    hasMultiRegionTrail: false,
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('CloudtrailNotMultiregion', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012');
    expect(finding.kind).toBe('cloudtrail-not-multiregion');
    expect(finding.severity).toBe('warning');
  });
});
