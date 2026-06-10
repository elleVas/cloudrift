import { EC2Client, DescribeNatGatewaysCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsNatGatewayRepositoryAdapter } from './aws-nat-gateway.repository.adapter';
import { AwsRegion, type PricingPort } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-cloudwatch');

const ec2Send = jest.fn();
const ec2Destroy = jest.fn();
const cwSend = jest.fn();
const cwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: ec2Send, destroy: ec2Destroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: cwSend, destroy: cwDestroy }));
});

const mockPricing: PricingPort = {
  getEbsVolumePricePerGbMonth: () => 0.08,
  getEbsSnapshotPricePerGbMonth: () => 0.05,
  getElasticIpPricePerMonth: () => 3.6,
  getRdsStoragePricePerGbMonth: () => 0.115,
  getLoadBalancerPricePerMonth: () => 16.2,
  getNatGatewayPricePerMonth: () => 32.4,
};

const region = AwsRegion.create('eu-west-1');
const adapter = new AwsNatGatewayRepositoryAdapter(mockPricing);

const natGatewayFixture = {
  NatGatewayId: 'nat-0abc123',
  VpcId: 'vpc-0123456789',
  CreateTime: new Date('2024-01-01'),
  Tags: [{ Key: 'Env', Value: 'dev' }],
};

describe('AwsNatGatewayRepositoryAdapter', () => {
  it('returns empty list when no available gateways exist', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [] });
    const result = await adapter.findIdleGateways(region);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(cwSend).not.toHaveBeenCalled();
  });

  it('returns idle gateways when BytesOutToDestination is zero', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [natGatewayFixture] });
    cwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 0 }] });

    const result = await adapter.findIdleGateways(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const gw = result.value[0];
    expect(gw.id).toBe('nat-0abc123');
    expect(gw.vpcId).toBe('vpc-0123456789');
    expect(gw.tags).toEqual({ Env: 'dev' });
  });

  it('excludes gateways with traffic above zero', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [natGatewayFixture] });
    cwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 1024 }] });

    const result = await adapter.findIdleGateways(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('treats missing CloudWatch datapoints as zero traffic (idle)', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [natGatewayFixture] });
    cwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await adapter.findIdleGateways(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('sends DescribeNatGatewaysCommand with available state filter', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [] });
    await adapter.findIdleGateways(region);
    expect(ec2Send).toHaveBeenCalledWith(expect.any(DescribeNatGatewaysCommand));
    const args = (DescribeNatGatewaysCommand as jest.Mock).mock.calls[0][0];
    expect(args.Filter).toEqual([{ Name: 'state', Values: ['available'] }]);
  });

  it('sends GetMetricStatisticsCommand for BytesOutToDestination', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [natGatewayFixture] });
    cwSend.mockResolvedValueOnce({ Datapoints: [] });
    await adapter.findIdleGateways(region);
    const args = (GetMetricStatisticsCommand as jest.Mock).mock.calls[0][0];
    expect(args.MetricName).toBe('BytesOutToDestination');
    expect(args.Namespace).toBe('AWS/NATGateway');
    expect(args.Dimensions).toEqual([{ Name: 'NatGatewayId', Value: 'nat-0abc123' }]);
  });

  it('destroys both clients after the call', async () => {
    ec2Send.mockResolvedValueOnce({ NatGateways: [] });
    await adapter.findIdleGateways(region);
    expect(ec2Destroy).toHaveBeenCalledTimes(1);
    expect(cwDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    ec2Send.mockRejectedValueOnce(new Error('Access denied'));
    const result = await adapter.findIdleGateways(region);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('NAT');
    }
  });

  it('still destroys both clients after failure', async () => {
    ec2Send.mockRejectedValueOnce(new Error('timeout'));
    await adapter.findIdleGateways(region);
    expect(ec2Destroy).toHaveBeenCalledTimes(1);
    expect(cwDestroy).toHaveBeenCalledTimes(1);
  });

  it('follows NextToken across multiple DescribeNatGateways pages', async () => {
    const gw2 = { ...natGatewayFixture, NatGatewayId: 'nat-page2' };

    ec2Send
      .mockResolvedValueOnce({ NatGateways: [natGatewayFixture], NextToken: 'cursor-2' })
      .mockResolvedValueOnce({ NatGateways: [gw2] });
    cwSend
      .mockResolvedValueOnce({ Datapoints: [] })   // gw nat-0abc123 → idle
      .mockResolvedValueOnce({ Datapoints: [] });  // gw nat-page2 → idle

    const result = await adapter.findIdleGateways(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((g) => g.id)).toEqual(['nat-0abc123', 'nat-page2']);
    const secondCallArgs = (DescribeNatGatewaysCommand as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.NextToken).toBe('cursor-2');
  });
});
