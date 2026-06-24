// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { AwsGp2UpgradeScanner } from './aws-gp2-upgrade.scanner';
import { AwsRegion, type Gp2Volume } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

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

const region = AwsRegion.create('us-east-1');
const scanner = new AwsGp2UpgradeScanner(mockPricing);
const OLD_DATE = new Date('2025-01-01');

describe('AwsGp2UpgradeScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ebs-gp2-upgrade');
  });

  it('maps gp2 volumes and computes the gp2→gp3 monthly saving', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-gp2a',
          Size: 200,
          VolumeType: 'gp2',
          State: 'in-use',
          CreateTime: OLD_DATE,
          Tags: [{ Key: 'Name', Value: 'data' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);

    const vol = result.value[0] as Gp2Volume;
    expect(vol.id).toBe('vol-gp2a');
    expect(vol.kind).toBe('ebs-gp2-upgrade');
    // (0.10 - 0.08) * 200 = 4.00
    expect(vol.costEstimate.monthlyCostUsd).toBeCloseTo(4, 2);
    expect(vol.wasteReason).toContain('saves $4.00/mo');
  });

  it('filters server-side on volume-type=gp2 AND status=in-use (no double counting)', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    const args = (DescribeVolumesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([
      { Name: 'volume-type', Values: ['gp2'] },
      { Name: 'status', Values: ['in-use'] },
    ]);
  });

  it('applies the grace period: a freshly created gp2 volume is not reported', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        { VolumeId: 'vol-new', Size: 100, VolumeType: 'gp2', State: 'in-use', CreateTime: new Date() },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('excludes a gp2 volume tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-keep',
          Size: 100,
          VolumeType: 'gp2',
          State: 'in-use',
          CreateTime: OLD_DATE,
          Tags: [{ Key: 'cloudrift:ignore', Value: 'true' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('follows NextToken across pages', async () => {
    mockSend
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-p1', Size: 50, VolumeType: 'gp2', State: 'in-use', CreateTime: OLD_DATE }],
        NextToken: 'cursor-2',
      })
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-p2', Size: 50, VolumeType: 'gp2', State: 'in-use', CreateTime: OLD_DATE }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vol-p1', 'vol-p2']);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('EBS');
    }
  });

  it('destroys the EC2Client after the call', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
