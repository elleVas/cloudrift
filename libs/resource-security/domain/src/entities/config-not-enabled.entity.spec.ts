// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { ConfigNotEnabled } from './config-not-enabled.entity';
import type { ConfigNotEnabledProps } from './config-not-enabled.entity';

const region = AwsRegion.create('eu-west-1');

function makeFinding(overrides: Partial<ConfigNotEnabledProps> = {}): ConfigNotEnabled {
  return new ConfigNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {}, ...overrides });
}

describe('ConfigNotEnabled', () => {
  it('exposes id (account:region), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012:eu-west-1');
    expect(finding.kind).toBe('config-not-enabled');
    expect(finding.severity).toBe('warning');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.region).toBe(region);
    expect(finding.accountId).toBe('123456789012');
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('eu-west-1');
  });
});
