import { LogGroup } from './log-group.entity';
import type { LogGroupProps } from './log-group.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeLogGroup(overrides: Partial<LogGroupProps> = {}): LogGroup {
  return new LogGroup({
    logGroupName: '/aws/lambda/my-fn',
    region,
    accountId: '123456789012',
    storedBytes: 1024 ** 3,
    creationTime: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 0.03,
    ...overrides,
  });
}

describe('LogGroup', () => {
  it('exposes correct id and fields', () => {
    const lg = makeLogGroup();
    expect(lg.id).toBe('/aws/lambda/my-fn');
    expect(lg.storedBytes).toBe(1024 ** 3);
    expect(lg.tags).toEqual({ Env: 'dev' });
  });

  it('hasRetentionPolicy returns false when retentionInDays is undefined', () => {
    expect(makeLogGroup({ retentionInDays: undefined }).hasRetentionPolicy()).toBe(false);
  });

  it('hasRetentionPolicy returns true when retentionInDays is set', () => {
    expect(makeLogGroup({ retentionInDays: 14 }).hasRetentionPolicy()).toBe(true);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeLogGroup().kind).toBe('log-group');
    expect(makeLogGroup().wasteReason).toContain('retention');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeLogGroup().costEstimate.monthlyCostUsd).toBe(0.03);
  });

  it('costEstimate description references the stored size', () => {
    expect(makeLogGroup().costEstimate.description).toContain('GB');
  });
});
