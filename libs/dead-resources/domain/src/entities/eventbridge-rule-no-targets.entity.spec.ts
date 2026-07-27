// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { EventbridgeRuleNoTargets } from './eventbridge-rule-no-targets.entity';
import type { EventbridgeRuleNoTargetsProps } from './eventbridge-rule-no-targets.entity';

function makeRule(overrides: Partial<EventbridgeRuleNoTargetsProps> = {}): EventbridgeRuleNoTargets {
  return new EventbridgeRuleNoTargets({
    ruleArn: 'arn:aws:events:us-east-1:123456789012:rule/nightly-cleanup',
    ruleName: 'nightly-cleanup',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('EventbridgeRuleNoTargets', () => {
  it('exposes correct id and fields', () => {
    const rule = makeRule();
    expect(rule.id).toBe('arn:aws:events:us-east-1:123456789012:rule/nightly-cleanup');
    expect(rule.ruleName).toBe('nightly-cleanup');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const rule = makeRule();
    expect(rule.kind).toBe('eventbridge-rule-no-targets');
    expect(rule.hygieneReason).toContain('no targets');
    expect(rule.severity).toBe('info');
  });

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('eu-west-1');
    const detectedAt = new Date('2026-07-23');
    const rule = makeRule({ region, accountId: '999999999999', detectedAt, tags: { env: 'prod' } });
    expect(rule.region).toBe(region);
    expect(rule.accountId).toBe('999999999999');
    expect(rule.detectedAt).toBe(detectedAt);
    expect(rule.tags).toEqual({ env: 'prod' });
  });
});
