import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { AwsEc2InstanceRepositoryAdapter } from './aws-ec2-instance.repository.adapter';
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
const adapter = new AwsEc2InstanceRepositoryAdapter(mockPricing);

const stoppedInstanceFixture = {
  InstanceId: 'i-0abc123',
  InstanceType: 't3.medium',
  State: { Name: 'stopped' },
  LaunchTime: new Date('2024-01-01'),
  BlockDeviceMappings: [{ Ebs: { VolumeId: 'vol-001' } }],
  Tags: [{ Key: 'Env', Value: 'dev' }],
};

const volumeFixture = {
  VolumeId: 'vol-001',
  Size: 50,
  VolumeType: 'gp3',
};

describe('AwsEc2InstanceRepositoryAdapter', () => {
  it('returns empty list when no instances found', async () => {
    mockSend.mockResolvedValueOnce({ Reservations: [] });
    const result = await adapter.findStoppedInstances(region);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('maps instances with resolved volume sizes', async () => {
    mockSend
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [stoppedInstanceFixture] }],
      })
      .mockResolvedValueOnce({ Volumes: [volumeFixture] });

    const result = await adapter.findStoppedInstances(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const inst = result.value[0];
    expect(inst.id).toBe('i-0abc123');
    expect(inst.instanceType).toBe('t3.medium');
    expect(inst.attachedVolumes).toHaveLength(1);
    expect(inst.attachedVolumes[0].sizeGb).toBe(50);
    expect(inst.attachedVolumes[0].volumeType).toBe('gp3');
    expect(inst.tags).toEqual({ Env: 'dev' });
  });

  it('sends DescribeInstancesCommand with stopped filter', async () => {
    mockSend.mockResolvedValueOnce({ Reservations: [] });
    await adapter.findStoppedInstances(region);
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeInstancesCommand));
    const args = (DescribeInstancesCommand as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'instance-state-name', Values: ['stopped'] }]);
  });

  it('does not call DescribeVolumes when no instances returned', async () => {
    mockSend.mockResolvedValueOnce({ Reservations: [] });
    await adapter.findStoppedInstances(region);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalledWith(expect.any(DescribeVolumesCommand));
  });

  it('destroys the EC2Client after the call', async () => {
    mockSend.mockResolvedValueOnce({ Reservations: [] });
    await adapter.findStoppedInstances(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access denied'));
    const result = await adapter.findStoppedInstances(region);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('EC2');
    }
  });

  it('still destroys the client after failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));
    await adapter.findStoppedInstances(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('follows NextToken across multiple DescribeInstances pages', async () => {
    const inst1 = { InstanceId: 'i-page1', InstanceType: 't3.micro', State: { Name: 'stopped' }, LaunchTime: new Date(), BlockDeviceMappings: [] };
    const inst2 = { InstanceId: 'i-page2', InstanceType: 't3.micro', State: { Name: 'stopped' }, LaunchTime: new Date(), BlockDeviceMappings: [] };

    mockSend
      .mockResolvedValueOnce({ Reservations: [{ Instances: [inst1] }], NextToken: 'cursor-2' })
      .mockResolvedValueOnce({ Reservations: [{ Instances: [inst2] }] });

    const result = await adapter.findStoppedInstances(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((i) => i.id)).toEqual(['i-page1', 'i-page2']);
    const secondCallArgs = (DescribeInstancesCommand as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.NextToken).toBe('cursor-2');
  });
});
