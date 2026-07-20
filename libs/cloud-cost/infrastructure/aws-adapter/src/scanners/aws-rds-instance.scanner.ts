// SPDX-License-Identifier: Apache-2.0
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from '@aws-sdk/client-rds';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  RdsInstanceStatus,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { RdsInstance, RdsInstanceWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';
import { NON_RDS_ENGINES } from '../utils/non-rds-engines';

const logger = createLogger('cloudrift:scanner');

type DbInstanceWithId = DBInstance & { DBInstanceIdentifier: string };

export class AwsRdsInstanceScanner implements WasteScannerPort {
  readonly kind = 'rds-instance' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new RdsInstanceWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new RDSClient({ ...createAwsClientConfig(), region: region.code });
    try {
      // `db-instance-status` is not a recognized DescribeDBInstances filter
      // name; RdsInstanceWastePolicy.judge() re-checks db.isStopped() below.
      const rawInstances = await paginate<DBInstance>(async (cursor) => {
        const r = await client.send(
          new DescribeDBInstancesCommand({ Marker: cursor }),
        );
        return { items: r.DBInstances ?? [], cursor: r.Marker };
      });

      const now = new Date();
      const validInstances = rawInstances.filter(
        (db): db is DbInstanceWithId => !!db.DBInstanceIdentifier && !NON_RDS_ENGINES.has(db.Engine ?? ''),
      );
      if (validInstances.length !== rawInstances.length) {
        logger.debug(
          `${this.kind}: skipped ${rawInstances.length - validInstances.length} entries with non-RDS engine or missing DBInstanceIdentifier`,
        );
      }

      const instances = validInstances
        .map((db) => {
          const storageType = db.StorageType ?? 'gp2';
          const allocatedStorageGb = db.AllocatedStorage ?? 0;
          const pricePerGb =
            this.pricing.getPrice(region, `rds-${storageType}`) || this.pricing.getPrice(region, 'rds-gp2');
          return new RdsInstance({
            dbInstanceIdentifier: db.DBInstanceIdentifier,
            region,
            accountId: this.accountId,
            dbInstanceClass: db.DBInstanceClass ?? 'unknown',
            engine: db.Engine ?? 'unknown',
            dbInstanceStatus: (db.DBInstanceStatus ?? 'stopped') as RdsInstanceStatus,
            allocatedStorageGb,
            storageType,
            multiAZ: db.MultiAZ ?? false,
            detectedAt: now,
            tags: Object.fromEntries(
              (db.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(pricePerGb * allocatedStorageGb).toFixed(4),
          });
        })
        .filter((db) => this.policy.evaluate(db, now).isWaste);

      return Result.ok(instances);
    } catch (err) {
      return Result.fail(new AwsAdapterError('RDS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
