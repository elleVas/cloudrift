// SPDX-License-Identifier: Apache-2.0
import { VpnConnection } from './vpn-connection.entity';
import type { VpnConnectionProps } from './vpn-connection.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeVpnConnection(overrides: Partial<VpnConnectionProps> = {}): VpnConnection {
  return new VpnConnection({
    vpnConnectionId: 'vpn-0123456789abcdef0',
    region,
    accountId: '123456789012',
    vpnGatewayId: 'vgw-0123456789abcdef0',
    transitGatewayId: undefined,
    tunnelBytesLastWindow: 0,
    metricWindowHours: 24,
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 36.5,
    ...overrides,
  });
}

describe('VpnConnection', () => {
  it('exposes correct id and fields', () => {
    const connection = makeVpnConnection();
    expect(connection.id).toBe('vpn-0123456789abcdef0');
    expect(connection.vpnGatewayId).toBe('vgw-0123456789abcdef0');
  });

  it('exposes kind', () => {
    expect(makeVpnConnection().kind).toBe('vpn-connection-idle');
  });

  it('wasteReason reports zero tunnel traffic over the metric window', () => {
    expect(makeVpnConnection({ metricWindowHours: 72 }).wasteReason).toBe('zero tunnel traffic in last 72h');
  });

  it('isIdle is true when there is no tunnel traffic in the window', () => {
    expect(makeVpnConnection({ tunnelBytesLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle is false when there is tunnel traffic in the window', () => {
    expect(makeVpnConnection({ tunnelBytesLastWindow: 2048 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeVpnConnection().costEstimate.monthlyCostUsd).toBe(36.5);
  });

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-06-09');
    const connection = makeVpnConnection({
      region,
      accountId: '999999999999',
      vpnGatewayId: undefined,
      transitGatewayId: 'tgw-0123456789abcdef0',
      tunnelBytesLastWindow: 256,
      metricWindowHours: 48,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(connection.region).toBe(region);
    expect(connection.accountId).toBe('999999999999');
    expect(connection.vpnGatewayId).toBeUndefined();
    expect(connection.transitGatewayId).toBe('tgw-0123456789abcdef0');
    expect(connection.tunnelBytesLastWindow).toBe(256);
    expect(connection.metricWindowHours).toBe(48);
    expect(connection.detectedAt).toBe(detectedAt);
    expect(connection.tags).toEqual({ env: 'prod' });
  });
});
