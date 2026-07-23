// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { LogsLogGroupEmpty } from '../entities/logs-loggroup-empty.entity';
import type { LogsLogGroupEmptyProps } from '../entities/logs-loggroup-empty.entity';
import { LogsLogGroupEmptyPolicy } from './logs-loggroup-empty.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeLogGroup(overrides: Partial<LogsLogGroupEmptyProps> = {}): LogsLogGroupEmpty {
  return new LogsLogGroupEmpty({
    arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/lg-1',
    logGroupName: '/lg-1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('LogsLogGroupEmptyPolicy', () => {
  const policy = new LogsLogGroupEmptyPolicy();

  it('flags an old empty log group', () => {
    const verdict = policy.evaluate(makeLogGroup(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('never stored');
  });

  it('does not flag a log group created within the grace period', () => {
    const verdict = policy.evaluate(makeLogGroup({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a log group created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeLogGroup({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a log group carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeLogGroup({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
