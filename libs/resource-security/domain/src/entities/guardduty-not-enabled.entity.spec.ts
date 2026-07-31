// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { GuarddutyNotEnabled } from './guardduty-not-enabled.entity';
import type { GuarddutyNotEnabledProps } from './guardduty-not-enabled.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<GuarddutyNotEnabledProps> = {}): GuarddutyNotEnabled {
  return new GuarddutyNotEnabled({
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('GuarddutyNotEnabled', () => {
  it('exposes id (account:region), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012:us-east-1');
    expect(finding.kind).toBe('guardduty-not-enabled');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-07-31');
    const finding = makeFinding({ detectedAt, tags: { env: 'prod' } });
    expect(finding.region).toBe(region);
    expect(finding.accountId).toBe('123456789012');
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('us-east-1');
  });
});
