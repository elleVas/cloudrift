import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { AwsEbsIdleScanner } from './aws-ebs-idle.scanner';
import { AwsRegion, type IdleEbsVolume } from 'cloud-cost-domain';
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
const scanner = new AwsEbsIdleScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function inUseVolume(overrides: Partial<{ VolumeId: string; VolumeType: string; Size: number; CreateTime: Date }> = {}) {
  return {
    VolumeId: overrides.VolumeId ?? 'vol-1',
    VolumeType: overrides.VolumeType ?? 'gp3',
    Size: overrides.Size ?? 100,
    State: 'in-use',
    CreateTime: overrides.CreateTime ?? OLD_DATE,
    Attachments: [{ InstanceId: 'i-123' }],
  };
}

describe('AwsEbsIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ebs-idle');
  });

  it('reports an old in-use volume with zero I/O and costs it at full price', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [inUseVolume()] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vol-1']);
    const vol = result.value[0] as IdleEbsVolume;
    expect(vol.kind).toBe('ebs-idle');
    expect(vol.attachedInstanceId).toBe('i-123');
    expect(vol.costEstimate.monthlyCostUsd).toBeCloseTo(8, 2); // 100 GB × $0.08
  });

  it('does not report a volume with I/O activity', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [inUseVolume()] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 5000 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created idle volume (grace period)', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [inUseVolume({ CreateTime: new Date() })] });
    mockCwSend.mockResolvedValue({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no in-use volumes exist', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('filters DescribeVolumes on status=in-use', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    const args = (DescribeVolumesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'status', Values: ['in-use'] }]);
  });

  it('queries VolumeReadOps and VolumeWriteOps for the volume', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [inUseVolume()] });
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });

    await scanner.scan(region);

    const metricCalls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls.map(
      (c) => c[0].MetricName,
    );
    expect(metricCalls).toContain('VolumeReadOps');
    expect(metricCalls).toContain('VolumeWriteOps');
    const firstArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(firstArgs.Dimensions).toEqual([{ Name: 'VolumeId', Value: 'vol-1' }]);
    expect(firstArgs.Namespace).toBe('AWS/EBS');
    expect(firstArgs.Period).toBe(48 * 3600);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEc2Send.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EBS');
    expect(mockEc2Destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
