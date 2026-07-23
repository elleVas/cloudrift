// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { CloudformationStackStuck } from '../entities/cloudformation-stack-stuck.entity';
import type { CloudformationStackStuckProps } from '../entities/cloudformation-stack-stuck.entity';
import { CloudformationStackStuckPolicy } from './cloudformation-stack-stuck.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeStack(overrides: Partial<CloudformationStackStuckProps> = {}): CloudformationStackStuck {
  return new CloudformationStackStuck({
    stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/s1/1',
    stackName: 's1',
    status: 'DELETE_FAILED',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('CloudformationStackStuckPolicy', () => {
  const policy = new CloudformationStackStuckPolicy();

  it('flags an old stuck stack', () => {
    const verdict = policy.evaluate(makeStack(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('DELETE_FAILED');
  });

  it('does not flag a stack created within the grace period', () => {
    const verdict = policy.evaluate(makeStack({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a stack created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeStack({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a stack carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeStack({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
