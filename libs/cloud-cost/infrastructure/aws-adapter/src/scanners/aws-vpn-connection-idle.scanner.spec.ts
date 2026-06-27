// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVpnConnectionsCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsVpnConnectionIdleScanner } from './aws-vpn-connection-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-cloudwatch');

const mockEc2Send = jest.fn();
const mockEc2Destroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockEc2Send, destroy: mockEc2Destroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsVpnConnectionIdleScanner(mockPricing);

describe('AwsVpnConnectionIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('vpn-connection-idle');
  });

  it('reports a VPN connection with zero tunnel traffic', async () => {
    mockEc2Send.mockResolvedValueOnce({
      VpnConnections: [{ VpnConnectionId: 'vpn-1', VpnGatewayId: 'vgw-1' }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vpn-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(36.5, 2);
  });

  it('does not report a VPN connection with tunnel traffic', async () => {
    mockEc2Send.mockResolvedValueOnce({ VpnConnections: [{ VpnConnectionId: 'vpn-busy' }] });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 1000 }] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no VPN connections exist', async () => {
    mockEc2Send.mockResolvedValueOnce({ VpnConnections: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('filters on available connections and queries the AWS/VPN namespace', async () => {
    mockEc2Send.mockResolvedValueOnce({ VpnConnections: [{ VpnConnectionId: 'vpn-1' }] });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const ec2Args = (DescribeVpnConnectionsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(ec2Args.Filters).toEqual([{ Name: 'state', Values: ['available'] }]);
    const cwArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls;
    expect(cwArgs[0][0].Namespace).toBe('AWS/VPN');
    expect(cwArgs[0][0].MetricName).toBe('TunnelDataIn');
    expect(cwArgs[0][0].Dimensions).toEqual([{ Name: 'VpnId', Value: 'vpn-1' }]);
    expect(cwArgs[1][0].MetricName).toBe('TunnelDataOut');
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEc2Send.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('VPN');
    expect(mockEc2Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
