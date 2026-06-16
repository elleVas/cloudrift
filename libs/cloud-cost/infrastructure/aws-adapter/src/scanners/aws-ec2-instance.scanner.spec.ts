import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';
import { AwsEc2InstanceScanner } from './aws-ec2-instance.scanner';
import { AwsRegion, type Ec2Instance } from 'cloud-cost-domain';
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
const scanner = new AwsEc2InstanceScanner(mockPricing);
const OLD_DATE = new Date('2025-01-01');

function mockBySendCommand(handlers: { instances?: unknown; volumes?: unknown }) {
  mockSend.mockImplementation((command: unknown) => {
    if (command instanceof DescribeInstancesCommand) {
      return Promise.resolve(handlers.instances ?? { Reservations: [] });
    }
    if (command instanceof DescribeVolumesCommand) {
      return Promise.resolve(handlers.volumes ?? { Volumes: [] });
    }
    return Promise.reject(new Error('unexpected command'));
  });
}

describe('AwsEc2InstanceScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-instance');
  });

  it('maps stopped instances, resolving attached volume sizes with a second call', async () => {
    mockBySendCommand({
      instances: {
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-1',
                InstanceType: 't3.micro',
                State: { Name: 'stopped' },
                LaunchTime: OLD_DATE,
                StateTransitionReason: 'User initiated (2025-02-01 10:00:00 GMT)',
                BlockDeviceMappings: [{ Ebs: { VolumeId: 'vol-a' } }],
              },
            ],
          },
        ],
      },
      volumes: {
        Volumes: [{ VolumeId: 'vol-a', Size: 50, VolumeType: 'gp3' }],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const instance = result.value[0] as Ec2Instance;
    expect(instance.attachedVolumes).toEqual([
      { volumeId: 'vol-a', sizeGb: 50, volumeType: 'gp3' },
    ]);
    // 50 GB × $0.08
    expect(instance.costEstimate.monthlyCostUsd).toBeCloseTo(4, 2);
    expect(instance.stoppedSince).toEqual(new Date('2025-02-01T10:00:00Z'));
  });

  it('skips the volumes call when no stopped instances exist', async () => {
    mockBySendCommand({ instances: { Reservations: [] } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(
      mockSend.mock.calls.filter(([c]) => c instanceof DescribeVolumesCommand),
    ).toHaveLength(0);
  });

  it('does not report an instance stopped within the grace period', async () => {
    const recentStop = new Date().toISOString().replace('T', ' ').slice(0, 19);
    mockBySendCommand({
      instances: {
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-recent',
                State: { Name: 'stopped' },
                LaunchTime: OLD_DATE,
                StateTransitionReason: `User initiated (${recentStop} GMT)`,
              },
            ],
          },
        ],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report an instance tagged cloudrift:ignore', async () => {
    mockBySendCommand({
      instances: {
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-keep',
                State: { Name: 'stopped' },
                LaunchTime: OLD_DATE,
                Tags: [{ Key: 'cloudrift:ignore', Value: '' }],
              },
            ],
          },
        ],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeInstancesCommand with the stopped state filter', async () => {
    mockBySendCommand({});

    await scanner.scan(region);

    const constructorArgs = (DescribeInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([
      { Name: 'instance-state-name', Values: ['stopped'] },
    ]);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EC2');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
