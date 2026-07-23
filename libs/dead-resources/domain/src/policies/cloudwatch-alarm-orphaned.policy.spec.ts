// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { CloudwatchAlarmOrphaned } from '../entities/cloudwatch-alarm-orphaned.entity';
import type { CloudwatchAlarmOrphanedProps } from '../entities/cloudwatch-alarm-orphaned.entity';
import { CloudwatchAlarmOrphanedPolicy } from './cloudwatch-alarm-orphaned.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeAlarm(overrides: Partial<CloudwatchAlarmOrphanedProps> = {}): CloudwatchAlarmOrphaned {
  return new CloudwatchAlarmOrphaned({
    alarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:a1',
    alarmName: 'a1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('CloudwatchAlarmOrphanedPolicy', () => {
  const policy = new CloudwatchAlarmOrphanedPolicy();

  it('flags an old orphaned alarm', () => {
    const verdict = policy.evaluate(makeAlarm(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('INSUFFICIENT_DATA');
  });

  it('does not flag an alarm configured within the grace period', () => {
    const verdict = policy.evaluate(makeAlarm({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags an alarm configured exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeAlarm({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag an alarm carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeAlarm({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
