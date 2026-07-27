// SPDX-License-Identifier: Apache-2.0
import { TransitGatewayAttachment } from './transit-gateway-attachment.entity';
import type { TransitGatewayAttachmentProps } from './transit-gateway-attachment.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeAttachment(overrides: Partial<TransitGatewayAttachmentProps> = {}): TransitGatewayAttachment {
  return new TransitGatewayAttachment({
    transitGatewayAttachmentId: 'tgw-attach-0123456789abcdef0',
    region,
    accountId: '123456789012',
    transitGatewayId: 'tgw-0123456789abcdef0',
    resourceType: 'vpc',
    bytesLastWindow: 0,
    metricWindowHours: 24,
    creationTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 36.5,
    ...overrides,
  });
}

describe('TransitGatewayAttachment', () => {
  it('exposes correct id and fields', () => {
    const attachment = makeAttachment();
    expect(attachment.id).toBe('tgw-attach-0123456789abcdef0');
    expect(attachment.transitGatewayId).toBe('tgw-0123456789abcdef0');
    expect(attachment.resourceType).toBe('vpc');
  });

  it('exposes kind', () => {
    expect(makeAttachment().kind).toBe('transit-gateway-idle-attachment');
  });

  it('wasteReason reports zero traffic over the metric window', () => {
    expect(makeAttachment({ metricWindowHours: 72 }).wasteReason).toBe('zero traffic in last 72h');
  });

  it('isIdle is true when there is no traffic in the window', () => {
    expect(makeAttachment({ bytesLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle is false when there is traffic in the window', () => {
    expect(makeAttachment({ bytesLastWindow: 1024 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeAttachment().costEstimate.monthlyCostUsd).toBe(36.5);
  });

  it('exposes the remaining props', () => {
    const creationTime = new Date('2025-03-01');
    const detectedAt = new Date('2026-06-09');
    const attachment = makeAttachment({
      region,
      accountId: '999999999999',
      bytesLastWindow: 512,
      metricWindowHours: 48,
      creationTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(attachment.region).toBe(region);
    expect(attachment.accountId).toBe('999999999999');
    expect(attachment.bytesLastWindow).toBe(512);
    expect(attachment.metricWindowHours).toBe(48);
    expect(attachment.creationTime).toBe(creationTime);
    expect(attachment.detectedAt).toBe(detectedAt);
    expect(attachment.tags).toEqual({ env: 'prod' });
  });
});
