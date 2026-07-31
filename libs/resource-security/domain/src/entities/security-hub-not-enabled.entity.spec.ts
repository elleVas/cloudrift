// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SecurityHubNotEnabled } from './security-hub-not-enabled.entity';
import type { SecurityHubNotEnabledProps } from './security-hub-not-enabled.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<SecurityHubNotEnabledProps> = {}): SecurityHubNotEnabled {
  return new SecurityHubNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {}, ...overrides });
}

describe('SecurityHubNotEnabled', () => {
  it('exposes id (account:region), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('123456789012:us-east-1');
    expect(finding.kind).toBe('security-hub-not-enabled');
    expect(finding.severity).toBe('warning');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('Security Hub');
  });
});
