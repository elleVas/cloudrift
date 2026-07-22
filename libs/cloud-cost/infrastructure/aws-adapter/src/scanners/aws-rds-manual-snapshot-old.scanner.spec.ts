// SPDX-License-Identifier: Apache-2.0
import { RDSClient, DescribeDBSnapshotsCommand } from '@aws-sdk/client-rds';
import { AwsRdsManualSnapshotOldScanner } from './aws-rds-manual-snapshot-old.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-rds');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (RDSClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsRdsManualSnapshotOldScanner(mockPricing);
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('AwsRdsManualSnapshotOldScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('rds-manual-snapshot-old');
  });

  it('returns an old manual snapshot', async () => {
    mockSend.mockResolvedValueOnce({
      DBSnapshots: [
        {
          DBSnapshotIdentifier: 'my-db-final-snapshot',
          DBInstanceIdentifier: 'my-db',
          Engine: 'postgres',
          AllocatedStorage: 100,
          SnapshotCreateTime: oldDate,
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual(['my-db-final-snapshot']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(9.5, 2);
  });

  it('does not flag a snapshot created less than the grace period ago', async () => {
    mockSend.mockResolvedValueOnce({
      DBSnapshots: [
        {
          DBSnapshotIdentifier: 'fresh-snapshot',
          AllocatedStorage: 20,
          SnapshotCreateTime: new Date(),
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a snapshot tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      DBSnapshots: [
        {
          DBSnapshotIdentifier: 'keep-snapshot',
          AllocatedStorage: 20,
          SnapshotCreateTime: oldDate,
          TagList: [{ Key: 'cloudrift:ignore', Value: '' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeDBSnapshotsCommand scoped to manual snapshots', async () => {
    mockSend.mockResolvedValueOnce({ DBSnapshots: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeDBSnapshotsCommand));
    const constructorArgs = (DescribeDBSnapshotsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.SnapshotType).toBe('manual');
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
