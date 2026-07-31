// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { ConfigNotEnabled } from '../entities/config-not-enabled.entity';
import { ConfigNotEnabledPolicy } from './config-not-enabled.policy';

const region = AwsRegion.create('eu-west-1');

describe('ConfigNotEnabledPolicy', () => {
  it('flags — the scanner only emits regions with no active recorder', () => {
    const finding = new ConfigNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new ConfigNotEnabledPolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new ConfigNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new ConfigNotEnabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
