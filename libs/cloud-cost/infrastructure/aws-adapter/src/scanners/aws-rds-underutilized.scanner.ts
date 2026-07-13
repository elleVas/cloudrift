// SPDX-License-Identifier: Apache-2.0
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from '@aws-sdk/client-rds';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { RdsUnderutilizedInstance, RdsUnderutilizedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { avgMaxMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_WINDOW_HOURS = 168;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');
/** Estimated saving from downsizing a tier (advisory, to be verified). */
const RIGHTSIZE_SAVING_FRACTION = 0.5;

/**
 * The price per RDS instance class is resolved on demand from the Pricing
 * API (the cardinality of class × engine × deployment is too high for the
 * static price list/the `warmUp` prefetch): `AwsPricingApiAdapter` satisfies
 * this interface via duck typing.
 */
export interface RdsInstancePricingSource {
  getRdsInstancePricePerMonth(
    region: AwsRegion,
    dbInstanceClass: string,
    engine: string,
    multiAZ: boolean,
  ): Promise<number | undefined>;
}

interface RdsPriceSpec {
  dbInstanceClass: string;
  engine: string;
  multiAZ: boolean;
}

type DbInstanceWithId = DBInstance & { DBInstanceIdentifier: string };

function priceSpecKey(spec: RdsPriceSpec): string {
  return `${spec.dbInstanceClass}::${spec.engine}::${spec.multiAZ}`;
}

function priceSpecOf(db: DBInstance): RdsPriceSpec {
  return {
    dbInstanceClass: db.DBInstanceClass ?? 'unknown',
    engine: db.Engine ?? 'unknown',
    multiAZ: db.MultiAZ ?? false,
  };
}

/**
 * Detects *available* RDS instances with maximum CPU below a threshold over
 * the entire observation window: likely oversizing. Advisory (optimization
 * category, estimate): low CPU does not guarantee that storage I/O or
 * connections are equally underutilized, it must be verified before a
 * rightsizing. Disjoint from `rds-instance` (which detects `stopped`
 * instances). Requires `--live-pricing`: without a price per instance
 * class, no saving can be estimated.
 */
export class AwsRdsUnderutilizedScanner extends CloudWatchIdleScanner<
  RDSClient,
  DbInstanceWithId,
  { avg: number; max: number },
  RdsUnderutilizedInstance
> {
  readonly kind = 'rds-underutilized' as const;
  protected readonly serviceLabel = 'RDS';

  constructor(
    private readonly pricing: RdsInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<RdsUnderutilizedInstance> = new RdsUnderutilizedPolicy(),
    windowHours = DEFAULT_WINDOW_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): RDSClient {
    return new RDSClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: RDSClient): void {
    client.destroy();
  }

  protected async listResources(client: RDSClient): Promise<DbInstanceWithId[]> {
    // `db-instance-status` is not a recognized DescribeDBInstances filter
    // name; status is checked in-memory below instead (no downstream policy
    // check re-derives it, unlike AwsRdsInstanceScanner).
    const instances = await paginate<DBInstance>(async (cursor) => {
      const r = await client.send(new DescribeDBInstancesCommand({ Marker: cursor }));
      return { items: r.DBInstances ?? [], cursor: r.Marker };
    });
    const valid = instances.filter(
      (db): db is DbInstanceWithId => !!db.DBInstanceIdentifier && db.DBInstanceStatus === 'available',
    );
    if (valid.length !== instances.length) {
      logger.debug(`${this.kind}: skipped ${instances.length - valid.length} entries not available or missing DBInstanceIdentifier`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, db: DbInstanceWithId, window: MetricWindow) {
    return avgMaxMetric(
      cw,
      'AWS/RDS',
      'CPUUtilization',
      [{ Name: 'DBInstanceIdentifier', Value: db.DBInstanceIdentifier }],
      window,
    );
  }

  protected override async resolvePrices(raw: DbInstanceWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const uniqueSpecs = [...new Map(raw.map((db) => [priceSpecKey(priceSpecOf(db)), priceSpecOf(db)])).values()];
    const entries = await mapWithConcurrency(uniqueSpecs, PRICING_CONCURRENCY, async (spec) => ({
      key: priceSpecKey(spec),
      price: (await this.pricing.getRdsInstancePricePerMonth(region, spec.dbInstanceClass, spec.engine, spec.multiAZ)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.key, e.price]));
  }

  protected toEntity(
    db: DbInstanceWithId,
    cpu: { avg: number; max: number },
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): RdsUnderutilizedInstance {
    const monthlyPrice = prices.get(priceSpecKey(priceSpecOf(db))) ?? 0;
    return new RdsUnderutilizedInstance({
      dbInstanceIdentifier: db.DBInstanceIdentifier,
      region,
      accountId: this.accountId,
      dbInstanceClass: db.DBInstanceClass ?? 'unknown',
      engine: db.Engine ?? 'unknown',
      avgCpuPercent: cpu.avg,
      maxCpuPercent: cpu.max,
      windowDays: +(this.windowHours / 24).toFixed(1),
      instanceCreateTime: db.InstanceCreateTime ?? new Date(),
      detectedAt: now,
      tags: Object.fromEntries((db.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +(monthlyPrice * RIGHTSIZE_SAVING_FRACTION).toFixed(4),
    });
  }
}
