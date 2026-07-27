// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { CloudwatchAlarmOrphaned } from './cloudwatch-alarm-orphaned.entity';
import type { CloudwatchAlarmOrphanedProps } from './cloudwatch-alarm-orphaned.entity';

function makeAlarm(overrides: Partial<CloudwatchAlarmOrphanedProps> = {}): CloudwatchAlarmOrphaned {
  return new CloudwatchAlarmOrphaned({
    alarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:old-alarm',
    alarmName: 'old-alarm',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('CloudwatchAlarmOrphaned', () => {
  it('exposes correct id and fields', () => {
    const alarm = makeAlarm();
    expect(alarm.id).toBe('arn:aws:cloudwatch:us-east-1:123456789012:alarm:old-alarm');
    expect(alarm.alarmName).toBe('old-alarm');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const alarm = makeAlarm();
    expect(alarm.kind).toBe('cloudwatch-alarm-orphaned');
    expect(alarm.hygieneReason).toContain('INSUFFICIENT_DATA');
    expect(alarm.severity).toBe('warning');
  });

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('eu-west-1');
    const createdAt = new Date('2022-01-01');
    const detectedAt = new Date('2026-07-23');
    const alarm = makeAlarm({ region, accountId: '999999999999', createdAt, detectedAt, tags: { env: 'prod' } });
    expect(alarm.region).toBe(region);
    expect(alarm.accountId).toBe('999999999999');
    expect(alarm.createdAt).toBe(createdAt);
    expect(alarm.detectedAt).toBe(detectedAt);
    expect(alarm.tags).toEqual({ env: 'prod' });
  });
});
