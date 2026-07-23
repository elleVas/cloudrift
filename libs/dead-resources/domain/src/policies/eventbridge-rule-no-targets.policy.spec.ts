// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { EventbridgeRuleNoTargets } from '../entities/eventbridge-rule-no-targets.entity';
import type { EventbridgeRuleNoTargetsProps } from '../entities/eventbridge-rule-no-targets.entity';
import { EventbridgeRuleNoTargetsPolicy } from './eventbridge-rule-no-targets.policy';
import { DEFAULT_IGNORE_TAG } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const region = AwsRegion.create('us-east-1');

function makeRule(overrides: Partial<EventbridgeRuleNoTargetsProps> = {}): EventbridgeRuleNoTargets {
  return new EventbridgeRuleNoTargets({
    ruleArn: 'arn:aws:events:us-east-1:123456789012:rule/rule-1',
    ruleName: 'rule-1',
    region,
    accountId: '123456789012',
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('EventbridgeRuleNoTargetsPolicy', () => {
  const policy = new EventbridgeRuleNoTargetsPolicy();

  it('flags a targetless rule with no grace period to wait out', () => {
    const verdict = policy.evaluate(makeRule(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('no targets');
  });

  it('does not flag a rule carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeRule({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
