import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { AwsRdsInstanceRepositoryAdapter } from './aws-rds-instance.repository.adapter';
import { AwsRegion, type PricingPort } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

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

const mockPricing: PricingPort = {
  getEbsVolumePricePerGbMonth: () => 0.08,
  getEbsSnapshotPricePerGbMonth: () => 0.05,
  getElasticIpPricePerMonth: () => 3.6,
  getRdsStoragePricePerGbMonth: () => 0.115,
  getLoadBalancerPricePerMonth: () => 16.2,
  getNatGatewayPricePerMonth: () => 32.4,
};

const region = AwsRegion.create('eu-west-1');
const adapter = new AwsRdsInstanceRepositoryAdapter(mockPricing);

describe('AwsRdsInstanceRepositoryAdapter', () => {
  it('returns an empty list when AWS returns no instances', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [] });
    const result = await adapter.findStoppedInstances(region);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('maps AWS DBInstance objects to RdsInstance entities', async () => {
    mockSend.mockResolvedValueOnce({
      DBInstances: [
        {
          DBInstanceIdentifier: 'my-db',
          DBInstanceClass: 'db.t3.medium',
          Engine: 'postgres',
          DBInstanceStatus: 'stopped',
          AllocatedStorage: 100,
          StorageType: 'gp2',
          MultiAZ: true,
          TagList: [{ Key: 'Env', Value: 'prod' }],
        },
      ],
    });

    const result = await adapter.findStoppedInstances(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const db = result.value[0];
    expect(db.id).toBe('my-db');
    expect(db.dbInstanceClass).toBe('db.t3.medium');
    expect(db.engine).toBe('postgres');
    expect(db.allocatedStorageGb).toBe(100);
    expect(db.multiAZ).toBe(true);
    expect(db.tags).toEqual({ Env: 'prod' });
  });

  it('sends DescribeDBInstancesCommand with stopped filter', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [] });
    await adapter.findStoppedInstances(region);
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeDBInstancesCommand));
    const constructorArgs = (DescribeDBInstancesCommand as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([
      { Name: 'db-instance-status', Values: ['stopped'] },
    ]);
  });

  it('destroys the RDSClient after the call', async () => {
    mockSend.mockResolvedValueOnce({ DBInstances: [] });
    await adapter.findStoppedInstances(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access denied'));
    const result = await adapter.findStoppedInstances(region);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('RDS');
    }
  });

  it('still destroys the client after a failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));
    await adapter.findStoppedInstances(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('follows Marker across multiple DescribeDBInstances pages', async () => {
    const base = { DBInstanceClass: 'db.t3.micro', Engine: 'mysql', DBInstanceStatus: 'stopped', AllocatedStorage: 20, StorageType: 'gp2', MultiAZ: false };

    mockSend
      .mockResolvedValueOnce({ DBInstances: [{ ...base, DBInstanceIdentifier: 'db-page1' }], Marker: 'marker-2' })
      .mockResolvedValueOnce({ DBInstances: [{ ...base, DBInstanceIdentifier: 'db-page2' }] });

    const result = await adapter.findStoppedInstances(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((db) => db.id)).toEqual(['db-page1', 'db-page2']);
    const secondCallArgs = (DescribeDBInstancesCommand as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.Marker).toBe('marker-2');
  });
});
