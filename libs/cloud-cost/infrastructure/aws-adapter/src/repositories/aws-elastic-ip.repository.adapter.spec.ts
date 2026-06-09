import { EC2Client, DescribeAddressesCommand } from '@aws-sdk/client-ec2';
import { AwsElasticIpRepositoryAdapter } from './aws-elastic-ip.repository.adapter';
import { AwsRegion, type PricingPort } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const mockPricing: PricingPort = {
  getEbsVolumePricePerGbMonth: () => 0.08,
  getEbsSnapshotPricePerGbMonth: () => 0.05,
  getElasticIpPricePerMonth: () => 3.6,
  getRdsStoragePricePerGbMonth: () => 0.115,
  getLoadBalancerPricePerMonth: () => 16.2,
  getNatGatewayPricePerMonth: () => 32.4,
};

const region = AwsRegion.create('us-east-1');
const adapter = new AwsElasticIpRepositoryAdapter(mockPricing);

describe('AwsElasticIpRepositoryAdapter', () => {
  it('returns an empty list when AWS returns no addresses', async () => {
    mockSend.mockResolvedValueOnce({ Addresses: [] });

    const result = await adapter.findUnassociatedElasticIps(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters out associated addresses', async () => {
    mockSend.mockResolvedValueOnce({
      Addresses: [
        { AllocationId: 'eip-1', PublicIp: '1.1.1.1', AssociationId: 'assoc-1', Tags: [] },
        { AllocationId: 'eip-2', PublicIp: '2.2.2.2', Tags: [] }, // unassociated
      ],
    });

    const result = await adapter.findUnassociatedElasticIps(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('eip-2');
  });

  it('maps AWS Address objects to ElasticIp entities', async () => {
    mockSend.mockResolvedValueOnce({
      Addresses: [
        {
          AllocationId: 'eipalloc-abc',
          PublicIp: '3.3.3.3',
          Tags: [{ Key: 'Name', Value: 'my-eip' }],
        },
      ],
    });

    const result = await adapter.findUnassociatedElasticIps(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const eip = result.value[0];
    expect(eip.id).toBe('eipalloc-abc');
    expect(eip.publicIp).toBe('3.3.3.3');
    expect(eip.tags).toEqual({ Name: 'my-eip' });
  });

  it('sends DescribeAddressesCommand with vpc domain filter', async () => {
    mockSend.mockResolvedValueOnce({ Addresses: [] });

    await adapter.findUnassociatedElasticIps(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeAddressesCommand));
    const constructorArgs = (DescribeAddressesCommand as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([
      { Name: 'domain', Values: ['vpc'] },
    ]);
  });

  it('destroys the EC2Client after the call', async () => {
    mockSend.mockResolvedValueOnce({ Addresses: [] });

    await adapter.findUnassociatedElasticIps(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access denied'));

    const result = await adapter.findUnassociatedElasticIps(region);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('ElasticIP');
    }
  });

  it('still destroys the client after a failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));

    await adapter.findUnassociatedElasticIps(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
