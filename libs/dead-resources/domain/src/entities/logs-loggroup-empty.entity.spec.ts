// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { LogsLogGroupEmpty } from './logs-loggroup-empty.entity';
import type { LogsLogGroupEmptyProps } from './logs-loggroup-empty.entity';

function makeLogGroup(overrides: Partial<LogsLogGroupEmptyProps> = {}): LogsLogGroupEmpty {
  return new LogsLogGroupEmpty({
    arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/lambda/old-function',
    logGroupName: '/lambda/old-function',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('LogsLogGroupEmpty', () => {
  it('exposes correct id (arn) and fields', () => {
    const lg = makeLogGroup();
    expect(lg.id).toBe('arn:aws:logs:us-east-1:123456789012:log-group:/lambda/old-function');
    expect(lg.logGroupName).toBe('/lambda/old-function');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const lg = makeLogGroup();
    expect(lg.kind).toBe('logs-loggroup-empty');
    expect(lg.hygieneReason).toContain('never stored');
    expect(lg.severity).toBe('info');
  });

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('eu-west-1');
    const createdAt = new Date('2022-01-01');
    const detectedAt = new Date('2026-07-23');
    const lg = makeLogGroup({ region, accountId: '999999999999', createdAt, detectedAt, tags: {} });
    expect(lg.region).toBe(region);
    expect(lg.accountId).toBe('999999999999');
    expect(lg.createdAt).toBe(createdAt);
    expect(lg.detectedAt).toBe(detectedAt);
    expect(lg.tags).toEqual({});
  });
});
