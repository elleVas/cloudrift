import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { AwsEbsVolumeRepositoryAdapter } from './aws-ebs-volume.repository.adapter';
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
const adapter = new AwsEbsVolumeRepositoryAdapter(mockPricing);

describe('AwsEbsVolumeRepositoryAdapter', () => {
  it('returns an empty list when AWS returns no volumes', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    const result = await adapter.findUnattachedVolumes(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('maps AWS Volume objects to EbsVolume entities', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-0abc123',
          Size: 100,
          VolumeType: 'gp3',
          State: 'available',
          CreateTime: new Date('2025-01-01'),
          Tags: [{ Key: 'Environment', Value: 'staging' }],
        },
      ],
    });

    const result = await adapter.findUnattachedVolumes(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);

    const vol = result.value[0];
    expect(vol.id).toBe('vol-0abc123');
    expect(vol.sizeGb).toBe(100);
    expect(vol.volumeType).toBe('gp3');
    expect(vol.state).toBe('available');
    expect(vol.tags).toEqual({ Environment: 'staging' });
  });

  it('sends DescribeVolumesCommand with available filter', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await adapter.findUnattachedVolumes(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeVolumesCommand));
    const constructorArgs = (DescribeVolumesCommand as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([
      { Name: 'status', Values: ['available'] },
    ]);
  });

  it('destroys the EC2Client after the call', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await adapter.findUnattachedVolumes(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));

    const result = await adapter.findUnattachedVolumes(region);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('EBS');
    }
  });

  it('still destroys the client after a failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));

    await adapter.findUnattachedVolumes(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('follows NextToken across multiple pages and aggregates all volumes', async () => {
    mockSend
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-page1', Size: 10, State: 'available' }],
        NextToken: 'cursor-2',
      })
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-page2', Size: 20, State: 'available' }],
      });

    const result = await adapter.findUnattachedVolumes(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((v) => v.id)).toEqual(['vol-page1', 'vol-page2']);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const secondCallArgs = (DescribeVolumesCommand as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.NextToken).toBe('cursor-2');
  });

  it('handles missing optional fields with safe defaults', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-xyz',
          Size: 50,
          State: 'available',
          // VolumeType and Tags omitted
        },
      ],
    });

    const result = await adapter.findUnattachedVolumes(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vol = result.value[0];
    expect(vol.volumeType).toBe('gp2');
    expect(vol.tags).toEqual({});
  });
});
