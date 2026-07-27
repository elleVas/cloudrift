// SPDX-License-Identifier: Apache-2.0
import { KinesisStream } from './kinesis-stream.entity';
import type { KinesisStreamProps } from './kinesis-stream.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeStream(overrides: Partial<KinesisStreamProps> = {}): KinesisStream {
  return new KinesisStream({
    streamName: 'my-kinesis-stream',
    region,
    accountId: '123456789012',
    openShardCount: 2,
    incomingActivityLastWindow: 0,
    metricWindowHours: 48,
    streamCreationTimestamp: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 21.9,
    ...overrides,
  });
}

describe('KinesisStream', () => {
  it('exposes correct id and fields', () => {
    const stream = makeStream();
    expect(stream.id).toBe('my-kinesis-stream');
    expect(stream.openShardCount).toBe(2);
  });

  it('exposes kind', () => {
    expect(makeStream().kind).toBe('kinesis-provisioned-idle-stream');
  });

  it('wasteReason references the metric window', () => {
    expect(makeStream({ metricWindowHours: 48 }).wasteReason).toBe('zero incoming records in last 48h');
  });

  it('isIdle returns true when no incoming activity was observed', () => {
    expect(makeStream({ incomingActivityLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when incoming activity was observed', () => {
    expect(makeStream({ incomingActivityLastWindow: 512 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeStream().costEstimate.monthlyCostUsd).toBe(21.9);
  });

  it('costEstimate description references the open shard count', () => {
    expect(makeStream({ openShardCount: 5 }).costEstimate.description).toContain('5 shards');
  });

  it('exposes the remaining props', () => {
    const streamCreationTimestamp = new Date('2024-01-01');
    const detectedAt = new Date('2026-06-09');
    const stream = makeStream({
      region,
      accountId: '999999999999',
      streamCreationTimestamp,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(stream.region).toBe(region);
    expect(stream.accountId).toBe('999999999999');
    expect(stream.streamCreationTimestamp).toBe(streamCreationTimestamp);
    expect(stream.detectedAt).toBe(detectedAt);
    expect(stream.tags).toEqual({ env: 'prod' });
  });
});
