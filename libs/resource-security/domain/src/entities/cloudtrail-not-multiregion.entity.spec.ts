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

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-07-23');
    const finding = makeFinding({ accountId: '999999999999', hasMultiRegionTrail: true, detectedAt, tags: { env: 'prod' } });
    expect(finding.accountId).toBe('999999999999');
    expect(finding.hasMultiRegionTrail).toBe(true);
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('multi-region logging');
  });
});
