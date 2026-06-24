// SPDX-License-Identifier: Apache-2.0
import { EC2Client } from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { AwsNatGatewayScanner } from './aws-nat-gateway.scanner';
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
  (EC2Client as jest.Mock).mockImplementation(() => ({
    send: mockEc2Send,
    destroy: mockEc2Destroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsNatGatewayScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsNatGatewayScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('nat-gateway');
  });

  it('reports an old gateway with zero outbound traffic', async () => {
    mockEc2Send.mockResolvedValueOnce({
      NatGateways: [
        { NatGatewayId: 'nat-idle', VpcId: 'vpc-1', CreateTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((gw) => gw.id)).toEqual(['nat-idle']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(32.4, 2);
  });

  it('does not report a gateway with outbound traffic', async () => {
    mockEc2Send.mockResolvedValueOnce({
      NatGateways: [
        { NatGatewayId: 'nat-busy', VpcId: 'vpc-1', CreateTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 123456 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created idle gateway (grace period)', async () => {
    mockEc2Send.mockResolvedValueOnce({
      NatGateways: [
        { NatGatewayId: 'nat-new', VpcId: 'vpc-1', CreateTime: new Date() },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no gateways exist', async () => {
    mockEc2Send.mockResolvedValueOnce({ NatGateways: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries the BytesOutToDestination metric per gateway', async () => {
    mockEc2Send.mockResolvedValueOnce({
      NatGateways: [{ NatGatewayId: 'nat-1', VpcId: 'vpc-1', CreateTime: OLD_DATE }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const cwArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cwArgs.MetricName).toBe('BytesOutToDestination');
    expect(cwArgs.Dimensions).toEqual([{ Name: 'NatGatewayId', Value: 'nat-1' }]);
    expect(cwArgs.Namespace).toBe('AWS/NATGateway');
    expect(cwArgs.Period).toBe(48 * 3600);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEc2Send.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('NAT');
    expect(mockEc2Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
