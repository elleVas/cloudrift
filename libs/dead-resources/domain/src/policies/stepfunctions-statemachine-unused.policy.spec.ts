// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { StepfunctionsStatemachineUnused } from '../entities/stepfunctions-statemachine-unused.entity';
import type { StepfunctionsStatemachineUnusedProps } from '../entities/stepfunctions-statemachine-unused.entity';
import { StepfunctionsStatemachineUnusedPolicy } from './stepfunctions-statemachine-unused.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);
const region = AwsRegion.create('us-east-1');

function makeMachine(overrides: Partial<StepfunctionsStatemachineUnusedProps> = {}): StepfunctionsStatemachineUnused {
  return new StepfunctionsStatemachineUnused({
    stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:machine-1',
    name: 'machine-1',
    region,
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('StepfunctionsStatemachineUnusedPolicy', () => {
  const policy = new StepfunctionsStatemachineUnusedPolicy();

  it('flags an old never-executed state machine', () => {
    const verdict = policy.evaluate(makeMachine(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('never been executed');
  });

  it('does not flag a state machine created within the grace period', () => {
    const verdict = policy.evaluate(makeMachine({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a state machine created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeMachine({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a state machine carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeMachine({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
