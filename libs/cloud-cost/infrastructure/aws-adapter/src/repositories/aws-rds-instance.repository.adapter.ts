import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from '@aws-sdk/client-rds';
import { Result } from 'shared-kernel';
import type { RdsInstanceRepositoryPort, AwsRegion, RdsInstanceStatus, PricingPort } from 'cloud-cost-domain';
import { RdsInstance } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsRdsInstanceRepositoryAdapter implements RdsInstanceRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId: string = 'unknown',
  ) {}

  async findStoppedInstances(
    region: AwsRegion,
  ): ReturnType<RdsInstanceRepositoryPort['findStoppedInstances']> {
    const client = new RDSClient({ region: region.code });
    try {
      const rawInstances = await paginate<DBInstance>(async (cursor) => {
        const r = await client.send(
          new DescribeDBInstancesCommand({
            Filters: [{ Name: 'db-instance-status', Values: ['stopped'] }],
            Marker: cursor,
          }),
        );
        return { items: r.DBInstances ?? [], cursor: r.Marker };
      });

      const instances = rawInstances.map((db: DBInstance) => {
        const storageType = db.StorageType ?? 'gp2';
        const allocatedStorageGb = db.AllocatedStorage ?? 0;
        const pricePerGb = this.pricing.getRdsStoragePricePerGbMonth(region, storageType);
        return new RdsInstance({
          dbInstanceIdentifier: db.DBInstanceIdentifier!,
          region,
          accountId: this.accountId,
          dbInstanceClass: db.DBInstanceClass ?? 'unknown',
          engine: db.Engine ?? 'unknown',
          dbInstanceStatus: (db.DBInstanceStatus ?? 'stopped') as RdsInstanceStatus,
          allocatedStorageGb,
          storageType,
          multiAZ: db.MultiAZ ?? false,
          detectedAt: new Date(),
          tags: Object.fromEntries(
            (db.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
          ),
          monthlyCostUsd: +(pricePerGb * allocatedStorageGb).toFixed(4),
        });
      });

      return Result.ok(instances);
    } catch (err) {
      return Result.fail(new AwsAdapterError('RDS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
