// SPDX-License-Identifier: Apache-2.0
import {
  RDSClient,
  DescribeDBSnapshotsCommand,
  type DBSnapshot,
} from '@aws-sdk/client-rds';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { RdsManualSnapshotOld, RdsManualSnapshotOldPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type DbSnapshotWithId = DBSnapshot & { DBSnapshotIdentifier: string };

export class AwsRdsManualSnapshotOldScanner implements WasteScannerPort {
  readonly kind = 'rds-manual-snapshot-old' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new RdsManualSnapshotOldPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new RDSClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawSnapshots = await paginate<DBSnapshot>(async (cursor) => {
        const r = await client.send(
          new DescribeDBSnapshotsCommand({ SnapshotType: 'manual', Marker: cursor }),
        );
        return { items: r.DBSnapshots ?? [], cursor: r.Marker };
      });

      const now = new Date();
      const pricePerGb = this.pricing.getPrice(region, 'rds-manual-snapshot');
      const validSnapshots = rawSnapshots.filter(
        (snap): snap is DbSnapshotWithId => !!snap.DBSnapshotIdentifier,
      );
      if (validSnapshots.length !== rawSnapshots.length) {
        logger.debug(
          `${this.kind}: skipped ${rawSnapshots.length - validSnapshots.length} entries missing DBSnapshotIdentifier`,
        );
      }

      const snapshots = validSnapshots
        .map((snap) => {
          const allocatedStorageGb = snap.AllocatedStorage ?? 0;
          return new RdsManualSnapshotOld({
            snapshotId: snap.DBSnapshotIdentifier,
            region,
            accountId: this.accountId,
            sourceDbInstanceId: snap.DBInstanceIdentifier ?? 'unknown',
            engine: snap.Engine ?? 'unknown',
            allocatedStorageGb,
            snapshotCreateTime: snap.SnapshotCreateTime ?? new Date(0),
            detectedAt: now,
            tags: Object.fromEntries((snap.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            monthlyCostUsd: +(pricePerGb * allocatedStorageGb).toFixed(4),
          });
        })
        .filter((snap) => this.policy.evaluate(snap, now).isWaste);

      return Result.ok(snapshots);
    } catch (err) {
      return Result.fail(new AwsAdapterError('RDS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
