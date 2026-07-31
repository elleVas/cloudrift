// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SecurityHubNotEnabled } from '../entities/security-hub-not-enabled.entity';
import { SecurityHubNotEnabledPolicy } from './security-hub-not-enabled.policy';

const region = AwsRegion.create('us-east-1');

describe('SecurityHubNotEnabledPolicy', () => {
  it('flags — the scanner only emits regions where Security Hub is not enabled', () => {
    const finding = new SecurityHubNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new SecurityHubNotEnabledPolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new SecurityHubNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new SecurityHubNotEnabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
