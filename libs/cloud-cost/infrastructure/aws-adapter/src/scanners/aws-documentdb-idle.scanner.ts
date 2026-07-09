// SPDX-License-Identifier: Apache-2.0
import { DocDBClient, DescribeDBInstancesCommand, type DBInstance } from '@aws-sdk/client-docdb';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { DocumentDbInstance, DocumentDbIdleInstancePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface DocDbInstancePricingSource {
  getDocDbInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined>;
}

type DbInstanceWithId = DBInstance & { DBInstanceIdentifier: string };

export class AwsDocumentDbIdleScanner extends CloudWatchIdleScanner<
  DocDBClient,
  DbInstanceWithId,
  number,
  DocumentDbInstance
> {
  readonly kind = 'documentdb-idle-instance' as const;
  protected readonly serviceLabel = 'DocumentDB';

  constructor(
    private readonly pricing: DocDbInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<DocumentDbInstance> = new DocumentDbIdleInstancePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): DocDBClient {
    return new DocDBClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: DocDBClient): void {
    client.destroy();
  }

  protected async listResources(client: DocDBClient): Promise<DbInstanceWithId[]> {
    const instances = await paginate<DBInstance>(async (cursor) => {
      const r = await client.send(
        new DescribeDBInstancesCommand({ Filters: [{ Name: 'engine', Values: ['docdb'] }], Marker: cursor }),
      );
      return { items: r.DBInstances ?? [], cursor: r.Marker };
    });
    const valid = instances.filter((i): i is DbInstanceWithId => !!i.DBInstanceIdentifier);
    if (valid.length !== instances.length) {
      logger.debug(`${this.kind}: skipped ${instances.length - valid.length} entries missing DBInstanceIdentifier`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, instance: DbInstanceWithId, window: MetricWindow) {
    return sumMetric(
      cw,
      'AWS/DocDB',
      'DatabaseConnections',
      [{ Name: 'DBInstanceIdentifier', Value: instance.DBInstanceIdentifier }],
      window,
    );
  }

  protected override async resolvePrices(raw: DbInstanceWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const instanceClasses = [...new Set(raw.map((i) => i.DBInstanceClass ?? 'unknown'))];
    const entries = await mapWithConcurrency(instanceClasses, PRICING_CONCURRENCY, async (instanceClass) => ({
      instanceClass,
      price: (await this.pricing.getDocDbInstancePricePerMonth(region, instanceClass)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceClass, e.price]));
  }

  protected toEntity(
    instance: DbInstanceWithId,
    connectionsLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): DocumentDbInstance {
    const dbInstanceClass = instance.DBInstanceClass ?? 'unknown';
    return new DocumentDbInstance({
      dbInstanceIdentifier: instance.DBInstanceIdentifier,
      region,
      accountId: this.accountId,
      dbInstanceClass,
      connectionsLastWindow,
      metricWindowHours: this.windowHours,
      instanceCreateTime: instance.InstanceCreateTime ?? new Date(0),
      detectedAt: now,
      // DescribeDBInstances doesn't return tags for DocumentDB (unlike RDS's DBInstance.TagList).
      tags: {},
      monthlyCostUsd: +(prices.get(dbInstanceClass) ?? 0).toFixed(4),
    });
  }
}
