// SPDX-License-Identifier: Apache-2.0
import { MqBroker } from './mq-broker.entity';
import type { MqBrokerProps } from './mq-broker.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeBroker(overrides: Partial<MqBrokerProps> = {}): MqBroker {
  return new MqBroker({
    brokerId: 'b-1234abcd-1234-abcd-1234-abcd1234abcd',
    brokerName: 'my-broker',
    region,
    accountId: '123456789012',
    hostInstanceType: 'mq.t3.micro',
    deploymentMode: 'SINGLE_INSTANCE',
    networkBytesLastWindow: 0,
    metricWindowHours: 336,
    created: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 15,
    ...overrides,
  });
}

describe('MqBroker', () => {
  it('exposes correct id and fields', () => {
    const broker = makeBroker();
    expect(broker.id).toBe('b-1234abcd-1234-abcd-1234-abcd1234abcd');
    expect(broker.brokerName).toBe('my-broker');
  });

  it('exposes kind', () => {
    expect(makeBroker().kind).toBe('mq-idle-broker');
  });

  it('wasteReason references the metric window', () => {
    expect(makeBroker({ metricWindowHours: 336 }).wasteReason).toBe('zero network traffic in last 336h');
  });

  it('isIdle returns true when there is zero network traffic', () => {
    expect(makeBroker({ networkBytesLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when there is network traffic', () => {
    expect(makeBroker({ networkBytesLastWindow: 1024 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the monthly cost and instance type description', () => {
    const broker = makeBroker({ hostInstanceType: 'mq.m5.large', monthlyCostUsd: 120 });
    expect(broker.costEstimate.monthlyCostUsd).toBe(120);
    expect(broker.costEstimate.description).toBe('Idle mq.m5.large MQ broker');
  });

  it('exposes the remaining props', () => {
    const created = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const broker = makeBroker({
      hostInstanceType: 'mq.m5.large',
      deploymentMode: 'ACTIVE_STANDBY_MULTI_AZ',
      networkBytesLastWindow: 4096,
      metricWindowHours: 168,
      created,
      region,
      accountId: '999999999999',
      tags: { env: 'prod' },
      detectedAt,
    });
    expect(broker.hostInstanceType).toBe('mq.m5.large');
    expect(broker.deploymentMode).toBe('ACTIVE_STANDBY_MULTI_AZ');
    expect(broker.networkBytesLastWindow).toBe(4096);
    expect(broker.metricWindowHours).toBe(168);
    expect(broker.created).toBe(created);
    expect(broker.region).toBe(region);
    expect(broker.accountId).toBe('999999999999');
    expect(broker.tags).toEqual({ env: 'prod' });
    expect(broker.detectedAt).toBe(detectedAt);
  });
});
