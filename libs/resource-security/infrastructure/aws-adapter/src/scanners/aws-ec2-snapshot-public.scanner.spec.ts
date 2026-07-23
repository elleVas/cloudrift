// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeSnapshotsCommand, DescribeSnapshotAttributeCommand } from '@aws-sdk/client-ec2';
import { AwsEc2SnapshotPublicScanner } from './aws-ec2-snapshot-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEc2SnapshotPublicScanner();

describe('AwsEc2SnapshotPublicScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-snapshot-public');
  });

  it('flags a snapshot with createVolumePermission granted to "all"', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof DescribeSnapshotsCommand) return Promise.resolve({ Snapshots: [{ SnapshotId: 'snap-1', VolumeId: 'vol-1' }] });
      if (command instanceof DescribeSnapshotAttributeCommand) return Promise.resolve({ CreateVolumePermissions: [{ Group: 'all' }] });
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['snap-1']);
  });

  it('does not flag a private snapshot', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof DescribeSnapshotsCommand) return Promise.resolve({ Snapshots: [{ SnapshotId: 'snap-2', VolumeId: 'vol-2' }] });
      if (command instanceof DescribeSnapshotAttributeCommand) return Promise.resolve({ CreateVolumePermissions: [] });
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
