// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  DescribeImagesCommand,
} from '@aws-sdk/client-ec2';
import { AwsEbsSnapshotScanner } from './aws-ebs-snapshot.scanner';
import { AwsRegion } from 'cloud-cost-domain';
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
const scanner = new AwsEbsSnapshotScanner(mockPricing);
const OLD_DATE = new Date('2023-06-01');

function mockBySendCommand(handlers: {
  snapshots?: unknown;
  volumes?: unknown;
  images?: unknown;
}) {
  mockSend.mockImplementation((command: unknown) => {
    if (command instanceof DescribeSnapshotsCommand) {
      return Promise.resolve(handlers.snapshots ?? { Snapshots: [] });
    }
    if (command instanceof DescribeVolumesCommand) {
      return Promise.resolve(handlers.volumes ?? { Volumes: [] });
    }
    if (command instanceof DescribeImagesCommand) {
      return Promise.resolve(handlers.images ?? { Images: [] });
    }
    return Promise.reject(new Error('unexpected command'));
  });
}

describe('AwsEbsSnapshotScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ebs-snapshot');
  });

  it('reports an old snapshot whose source volume no longer exists', async () => {
    mockBySendCommand({
      snapshots: {
        Snapshots: [
          { SnapshotId: 'snap-orphan', VolumeId: 'vol-gone', VolumeSize: 100, StartTime: OLD_DATE },
        ],
      },
      volumes: { Volumes: [{ VolumeId: 'vol-alive' }] },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual(['snap-orphan']);
    // 100 GB × $0.05
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(5, 2);
  });

  it('does not report a snapshot whose source volume still exists', async () => {
    mockBySendCommand({
      snapshots: {
        Snapshots: [
          { SnapshotId: 'snap-ok', VolumeId: 'vol-alive', VolumeSize: 10, StartTime: OLD_DATE },
        ],
      },
      volumes: { Volumes: [{ VolumeId: 'vol-alive' }] },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a snapshot referenced by a registered AMI', async () => {
    mockBySendCommand({
      snapshots: {
        Snapshots: [
          { SnapshotId: 'snap-ami', VolumeId: 'vol-gone', VolumeSize: 10, StartTime: OLD_DATE },
        ],
      },
      images: {
        Images: [
          {
            ImageId: 'ami-1',
            BlockDeviceMappings: [{ Ebs: { SnapshotId: 'snap-ami' } }],
          },
        ],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a recent orphan snapshot (grace period)', async () => {
    mockBySendCommand({
      snapshots: {
        Snapshots: [
          { SnapshotId: 'snap-new', VolumeId: 'vol-gone', VolumeSize: 10, StartTime: new Date() },
        ],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('requests only self-owned snapshots and AMIs', async () => {
    mockBySendCommand({});

    await scanner.scan(region);

    const snapArgs = (DescribeSnapshotsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(snapArgs.OwnerIds).toEqual(['self']);
    const imageArgs = (DescribeImagesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(imageArgs.Owners).toEqual(['self']);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValue(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
