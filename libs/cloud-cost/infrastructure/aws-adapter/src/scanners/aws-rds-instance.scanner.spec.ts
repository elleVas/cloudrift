// SPDX-License-Identifier: Apache-2.0
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { AwsRdsInstanceScanner } from './aws-rds-instance.scanner';
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
const scanner = new AwsRdsInstanceScanner(mockPricing);

describe('AwsRdsInstanceScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('rds-instance');
  });

  it('maps stopped DB instances to RdsInstance entities with storage cost', async () => {
    mockSend.mockResolvedValueOnce({
      DBInstances: [
        {
          DBInstanceIdentifier: 'db-1',
          DBInstanceClass: 'db.t3.micro',
          Engine: 'postgres',
          DBInstanceStatus: 'stopped',
          AllocatedStorage: 100,
          StorageType: 'gp2',
          TagList: [{ Key: 'Team', Value: 'data' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('db-1');
    // 100 GB × $0.115
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(11.5, 2);
  });

  it('does not report a stopped instance tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      DBInstances: [
        {
          DBInstanceIdentifier: 'db-keep',
          DBInstanceStatus: 'stopped',
          AllocatedStorage: 10,
          TagList: [{ Key: 'cloudrift:ignore', Value: '' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeDBInstancesCommand with no status filter (db-instance-status is not a valid RDS filter name)', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [] });

    await scanner.scan(region);

    const constructorArgs = (DescribeDBInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toBeUndefined();
  });

  it('excludes non-stopped instances via the policy, since AWS returns every status unfiltered', async () => {
    mockSend.mockResolvedValueOnce({
      DBInstances: [
        { DBInstanceIdentifier: 'db-available', DBInstanceStatus: 'available', AllocatedStorage: 10 },
        { DBInstanceIdentifier: 'db-stopped', DBInstanceStatus: 'stopped', AllocatedStorage: 10 },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((db) => db.id)).toEqual(['db-stopped']);
  });

  it('follows the Marker cursor across pages', async () => {
    mockSend
      .mockResolvedValueOnce({
        DBInstances: [{ DBInstanceIdentifier: 'db-p1', DBInstanceStatus: 'stopped', AllocatedStorage: 10 }],
        Marker: 'm2',
      })
      .mockResolvedValueOnce({
        DBInstances: [{ DBInstanceIdentifier: 'db-p2', DBInstanceStatus: 'stopped', AllocatedStorage: 10 }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((db) => db.id)).toEqual(['db-p1', 'db-p2']);
    const secondCallArgs = (DescribeDBInstancesCommand as unknown as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.Marker).toBe('m2');
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('RDS');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
