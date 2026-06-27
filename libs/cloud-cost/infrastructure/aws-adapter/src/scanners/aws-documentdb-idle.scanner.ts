// SPDX-License-Identifier: Apache-2.0
import { DocDBClient, DescribeDBInstancesCommand, type DBInstance } from '@aws-sdk/client-docdb';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { DocumentDbInstance, DocumentDbIdleInstancePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

export interface DocDbInstancePricingSource {
  getDocDbInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined>;
}

/**
 * Detects DocumentDB instances with zero database connections in the
 * observed window. Requires `--live-pricing`: without a price per
 * instance class, no saving can be estimated.
 */
export class AwsDocumentDbIdleScanner implements WasteScannerPort {
  readonly kind = 'documentdb-idle-instance' as const;

  constructor(
    private readonly pricing: DocDbInstancePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new DocumentDbIdleInstancePolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const docdb = new DocDBClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const instances = await paginate<DBInstance>(async (cursor) => {
        const r = await docdb.send(
          new DescribeDBInstancesCommand({
            Filters: [{ Name: 'engine', Values: ['docdb'] }],
            Marker: cursor,
          }),
        );
        return { items: r.DBInstances ?? [], cursor: r.Marker };
      });

      if (instances.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const connections = await mapWithConcurrency(instances, CLOUDWATCH_CONCURRENCY, (instance) =>
        this.sumConnections(cw, instance.DBInstanceIdentifier!, startTime, endTime, periodSeconds),
      );

      const instanceClasses = [...new Set(instances.map((i) => i.DBInstanceClass ?? 'unknown'))];
      const priceEntries = await mapWithConcurrency(instanceClasses, CLOUDWATCH_CONCURRENCY, async (instanceClass) => ({
        instanceClass,
        price: (await this.pricing.getDocDbInstancePricePerMonth(region, instanceClass)) ?? 0,
      }));
      const priceByClass = new Map(priceEntries.map((e) => [e.instanceClass, e.price]));

      const now = new Date();
      const idle = instances
        .map((instance, index) => {
          const dbInstanceClass = instance.DBInstanceClass ?? 'unknown';
          return new DocumentDbInstance({
            dbInstanceIdentifier: instance.DBInstanceIdentifier!,
            region,
            accountId: this.accountId,
            dbInstanceClass,
            connectionsLastWindow: connections[index],
            metricWindowHours: this.windowHours,
            instanceCreateTime: instance.InstanceCreateTime ?? new Date(0),
            detectedAt: now,
            // DescribeDBInstances doesn't return tags for DocumentDB (unlike RDS's DBInstance.TagList).
            tags: {},
            monthlyCostUsd: +(priceByClass.get(dbInstanceClass) ?? 0).toFixed(4),
          });
        })
        .filter((instance) => this.policy.evaluate(instance, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('DocumentDB', err as Error));
    } finally {
      docdb.destroy();
      cw.destroy();
    }
  }

  private async sumConnections(
    cw: CloudWatchClient,
    dbInstanceIdentifier: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/DocDB',
        MetricName: 'DatabaseConnections',
        Dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbInstanceIdentifier }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
