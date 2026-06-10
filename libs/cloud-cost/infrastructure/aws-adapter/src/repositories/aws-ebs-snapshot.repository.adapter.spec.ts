import { EC2Client, DescribeSnapshotsCommand, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { AwsEbsSnapshotRepositoryAdapter } from './aws-ebs-snapshot.repository.adapter';
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

const region = AwsRegion.create('eu-west-1');
const adapter = new AwsEbsSnapshotRepositoryAdapter(mockPricing);

const snapshotFixture = {
  SnapshotId: 'snap-0abc123',
  VolumeId: 'vol-deleted',
  VolumeSize: 100,
  StartTime: new Date('2023-06-01'),
  Description: 'old backup',
  Tags: [{ Key: 'Project', Value: 'legacy' }],
};

const existingVolumeFixture = {
  VolumeId: 'vol-existing',
  Size: 50,
  VolumeType: 'gp2',
};

describe('AwsEbsSnapshotRepositoryAdapter', () => {
  it('returns empty list when no snapshots exist', async () => {
    mockSend
      .mockResolvedValueOnce({ Snapshots: [] })
      .mockResolvedValueOnce({ Volumes: [] });
    const result = await adapter.findOrphanSnapshots(region);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns empty list when all snapshots have existing source volumes', async () => {
    mockSend
      .mockResolvedValueOnce({
        Snapshots: [{ ...snapshotFixture, VolumeId: 'vol-existing' }],
      })
      .mockResolvedValueOnce({ Volumes: [existingVolumeFixture] });
    const result = await adapter.findOrphanSnapshots(region);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('identifies orphan snapshots whose source volume is gone', async () => {
    mockSend
      .mockResolvedValueOnce({ Snapshots: [snapshotFixture] })
      .mockResolvedValueOnce({ Volumes: [existingVolumeFixture] });

    const result = await adapter.findOrphanSnapshots(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const snap = result.value[0];
    expect(snap.id).toBe('snap-0abc123');
    expect(snap.sourceVolumeId).toBe('vol-deleted');
    expect(snap.sizeGb).toBe(100);
    expect(snap.tags).toEqual({ Project: 'legacy' });
  });

  it('sends DescribeSnapshotsCommand with self owner filter', async () => {
    mockSend
      .mockResolvedValueOnce({ Snapshots: [] })
      .mockResolvedValueOnce({ Volumes: [] });
    await adapter.findOrphanSnapshots(region);
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeSnapshotsCommand));
    const args = (DescribeSnapshotsCommand as jest.Mock).mock.calls[0][0];
    expect(args.OwnerIds).toEqual(['self']);
  });

  it('destroys the EC2Client after the call', async () => {
    mockSend
      .mockResolvedValueOnce({ Snapshots: [] })
      .mockResolvedValueOnce({ Volumes: [] });
    await adapter.findOrphanSnapshots(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access denied'));
    const result = await adapter.findOrphanSnapshots(region);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('EC2');
    }
  });

  it('still destroys the client after failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));
    await adapter.findOrphanSnapshots(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('follows NextToken for snapshots across multiple pages', async () => {
    mockSend
      .mockResolvedValueOnce({
        Snapshots: [{ ...snapshotFixture, SnapshotId: 'snap-p1' }],
        NextToken: 'snap-cursor-2',
      })
      .mockResolvedValueOnce({ Volumes: [] })
      .mockResolvedValueOnce({
        Snapshots: [{ ...snapshotFixture, SnapshotId: 'snap-p2' }],
      });

    const result = await adapter.findOrphanSnapshots(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((s) => s.id)).toEqual(['snap-p1', 'snap-p2']);
  });
});
