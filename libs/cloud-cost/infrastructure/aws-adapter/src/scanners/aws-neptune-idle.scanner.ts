// SPDX-License-Identifier: Apache-2.0
import { NeptuneClient, DescribeDBInstancesCommand, type DBInstance } from '@aws-sdk/client-neptune';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { NeptuneInstance, NeptuneIdleInstancePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface NeptuneInstancePricingSource {
  getNeptuneInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined>;
}

type DbInstanceWithId = DBInstance & { DBInstanceIdentifier: string };

export class AwsNeptuneIdleScanner extends CloudWatchIdleScanner<NeptuneClient, DbInstanceWithId, number, NeptuneInstance> {
  readonly kind = 'neptune-idle-instance' as const;
  protected readonly serviceLabel = 'Neptune';

  constructor(
    private readonly pricing: NeptuneInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<NeptuneInstance> = new NeptuneIdleInstancePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): NeptuneClient {
    return new NeptuneClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: NeptuneClient): void {
    client.destroy();
  }

  protected async listResources(client: NeptuneClient): Promise<DbInstanceWithId[]> {
    const instances = await paginate<DBInstance>(async (cursor) => {
      const r = await client.send(
        new DescribeDBInstancesCommand({ Filters: [{ Name: 'engine', Values: ['neptune'] }], Marker: cursor }),
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
      'AWS/Neptune',
      'TotalRequestsPerSec',
      [{ Name: 'DBInstanceIdentifier', Value: instance.DBInstanceIdentifier }],
      window,
    );
  }

  protected override async resolvePrices(raw: DbInstanceWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const instanceClasses = [...new Set(raw.map((i) => i.DBInstanceClass ?? 'unknown'))];
    const entries = await mapWithConcurrency(instanceClasses, PRICING_CONCURRENCY, async (instanceClass) => ({
      instanceClass,
      price: (await this.pricing.getNeptuneInstancePricePerMonth(region, instanceClass)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceClass, e.price]));
  }

  protected toEntity(
    instance: DbInstanceWithId,
    requestsLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): NeptuneInstance {
    const dbInstanceClass = instance.DBInstanceClass ?? 'unknown';
    return new NeptuneInstance({
      dbInstanceIdentifier: instance.DBInstanceIdentifier,
      region,
      accountId: this.accountId,
      dbInstanceClass,
      requestsLastWindow,
      metricWindowHours: this.windowHours,
      instanceCreateTime: instance.InstanceCreateTime ?? new Date(0),
      detectedAt: now,
      // DescribeDBInstances doesn't return tags for Neptune (unlike RDS's DBInstance.TagList).
      tags: {},
      monthlyCostUsd: +(prices.get(dbInstanceClass) ?? 0).toFixed(4),
    });
  }
}
