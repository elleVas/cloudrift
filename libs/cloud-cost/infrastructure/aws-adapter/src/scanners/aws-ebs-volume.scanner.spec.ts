// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { AwsEbsVolumeScanner } from './aws-ebs-volume.scanner';
import { AwsRegion, type PricingPort } from 'cloud-cost-domain';
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
const scanner = new AwsEbsVolumeScanner(mockPricing);
const OLD_DATE = new Date('2025-01-01');

describe('AwsEbsVolumeScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ebs-volume');
  });

  it('returns an empty list when AWS returns no volumes', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    const result = await scanner.scan(region);

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
          CreateTime: OLD_DATE,
          Tags: [{ Key: 'Environment', Value: 'staging' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);

    const vol = result.value[0];
    expect(vol.id).toBe('vol-0abc123');
    expect(vol.kind).toBe('ebs-volume');
    expect(vol.tags).toEqual({ Environment: 'staging' });
    expect(vol.costEstimate.monthlyCostUsd).toBeCloseTo(8, 2);
  });

  it('applies the waste policy: a volume created within the grace period is not reported', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        { VolumeId: 'vol-new', Size: 10, State: 'available', CreateTime: new Date() },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('applies the waste policy: a volume tagged cloudrift:ignore is not reported', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-keep',
          Size: 10,
          State: 'available',
          CreateTime: OLD_DATE,
          Tags: [{ Key: 'cloudrift:ignore', Value: 'true' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeVolumesCommand with available filter', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeVolumesCommand));
    const constructorArgs = (DescribeVolumesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([
      { Name: 'status', Values: ['available'] },
    ]);
  });

  it('destroys the EC2Client after the call', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
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

  it('still destroys the client after a failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));

    await scanner.scan(region);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('follows NextToken across multiple pages and aggregates all volumes', async () => {
    mockSend
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-page1', Size: 10, State: 'available', CreateTime: OLD_DATE }],
        NextToken: 'cursor-2',
      })
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-page2', Size: 20, State: 'available', CreateTime: OLD_DATE }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vol-page1', 'vol-page2']);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const secondCallArgs = (DescribeVolumesCommand as unknown as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.NextToken).toBe('cursor-2');
  });

  it('handles missing optional fields with safe defaults', async () => {
    mockSend.mockResolvedValueOnce({
      Volumes: [
        { VolumeId: 'vol-xyz', Size: 50, State: 'available', CreateTime: OLD_DATE },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vol = result.value[0] as import('cloud-cost-domain').EbsVolume;
    expect(vol.volumeType).toBe('gp2');
    expect(vol.tags).toEqual({});
  });
});

// Ensures the mock pricing stays aligned with the real PricingPort.
const _typecheck: PricingPort = mockPricing;
void _typecheck;
