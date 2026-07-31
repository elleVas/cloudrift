// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { GuarddutyNotEnabled } from '../entities/guardduty-not-enabled.entity';
import { GuarddutyNotEnabledPolicy } from './guardduty-not-enabled.policy';

const region = AwsRegion.create('us-east-1');

function makeFinding(): GuarddutyNotEnabled {
  return new GuarddutyNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
}

describe('GuarddutyNotEnabledPolicy', () => {
  it('flags — the scanner only emits regions with no detector', () => {
    expect(new GuarddutyNotEnabledPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new GuarddutyNotEnabled({ region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new GuarddutyNotEnabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
