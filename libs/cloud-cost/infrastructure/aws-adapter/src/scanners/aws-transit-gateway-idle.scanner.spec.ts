// SPDX-License-Identifier: Apache-2.0
import { EC2Client } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsTransitGatewayIdleScanner } from './aws-transit-gateway-idle.scanner';
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
const scanner = new AwsTransitGatewayIdleScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsTransitGatewayIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('transit-gateway-idle-attachment');
  });

  it('reports an old attachment with zero traffic', async () => {
    mockEc2Send.mockResolvedValueOnce({
      TransitGatewayAttachments: [
        {
          TransitGatewayAttachmentId: 'tgw-attach-1',
          TransitGatewayId: 'tgw-1',
          ResourceType: 'vpc',
          CreationTime: OLD_DATE,
        },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((a) => a.id)).toEqual(['tgw-attach-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(36.5, 2);
  });

  it('does not report an attachment with traffic', async () => {
    mockEc2Send.mockResolvedValueOnce({
      TransitGatewayAttachments: [
        { TransitGatewayAttachmentId: 'tgw-busy', TransitGatewayId: 'tgw-1', ResourceType: 'vpc', CreationTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 999 }] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created attachment (grace period)', async () => {
    mockEc2Send.mockResolvedValueOnce({
      TransitGatewayAttachments: [
        { TransitGatewayAttachmentId: 'tgw-new', TransitGatewayId: 'tgw-1', ResourceType: 'vpc', CreationTime: new Date() },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no attachments exist', async () => {
    mockEc2Send.mockResolvedValueOnce({ TransitGatewayAttachments: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries BytesIn/BytesOut from the AWS/TransitGateway namespace', async () => {
    mockEc2Send.mockResolvedValueOnce({
      TransitGatewayAttachments: [
        { TransitGatewayAttachmentId: 'tgw-attach-1', TransitGatewayId: 'tgw-1', ResourceType: 'vpc', CreationTime: OLD_DATE },
      ],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const calls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls;
    expect(calls[0][0].Namespace).toBe('AWS/TransitGateway');
    expect(calls[0][0].MetricName).toBe('BytesIn');
    expect(calls[0][0].Dimensions).toEqual([
      { Name: 'TransitGateway', Value: 'tgw-1' },
      { Name: 'TransitGatewayAttachment', Value: 'tgw-attach-1' },
    ]);
    expect(calls[1][0].MetricName).toBe('BytesOut');
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEc2Send.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('TransitGateway');
    expect(mockEc2Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
