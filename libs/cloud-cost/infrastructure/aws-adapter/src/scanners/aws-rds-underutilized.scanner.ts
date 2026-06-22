import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from '@aws-sdk/client-rds';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { RdsUnderutilizedInstance, RdsUnderutilizedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_WINDOW_HOURS = 168;
const CLOUDWATCH_CONCURRENCY = 5;
const PRICING_CONCURRENCY = 5;
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
export class AwsRdsUnderutilizedScanner implements WasteScannerPort {
  readonly kind = 'rds-underutilized' as const;

  constructor(
    private readonly pricing: RdsInstancePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new RdsUnderutilizedPolicy(),
    private readonly windowHours = DEFAULT_WINDOW_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const rds = new RDSClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const rawInstances = await paginate<DBInstance>(async (cursor) => {
        const r = await rds.send(
          new DescribeDBInstancesCommand({
            Filters: [{ Name: 'db-instance-status', Values: ['available'] }],
            Marker: cursor,
          }),
        );
        return { items: r.DBInstances ?? [], cursor: r.Marker };
      });

      if (rawInstances.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const cpu = await mapWithConcurrency(rawInstances, CLOUDWATCH_CONCURRENCY, (db) =>
        this.cpuStats(cw, db.DBInstanceIdentifier!, startTime, endTime, periodSeconds),
      );

      const uniqueSpecs = [
        ...new Map(rawInstances.map((db) => [priceSpecKey(priceSpecOf(db)), priceSpecOf(db)])).values(),
      ];
      const priceEntries = await mapWithConcurrency(
        uniqueSpecs,
        PRICING_CONCURRENCY,
        async (spec) => ({
          key: priceSpecKey(spec),
          price:
            (await this.pricing.getRdsInstancePricePerMonth(
              region,
              spec.dbInstanceClass,
              spec.engine,
              spec.multiAZ,
            )) ?? 0,
        }),
      );
      const priceBySpec = new Map(priceEntries.map((e) => [e.key, e.price]));

      const now = new Date();
      const instances = rawInstances
        .map((db: DBInstance, index) => {
          const monthlyPrice = priceBySpec.get(priceSpecKey(priceSpecOf(db))) ?? 0;
          return new RdsUnderutilizedInstance({
            dbInstanceIdentifier: db.DBInstanceIdentifier!,
            region,
            accountId: this.accountId,
            dbInstanceClass: db.DBInstanceClass ?? 'unknown',
            engine: db.Engine ?? 'unknown',
            avgCpuPercent: cpu[index].avg,
            maxCpuPercent: cpu[index].max,
            windowDays: +(this.windowHours / 24).toFixed(1),
            instanceCreateTime: db.InstanceCreateTime ?? new Date(),
            detectedAt: now,
            tags: Object.fromEntries(
              (db.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(monthlyPrice * RIGHTSIZE_SAVING_FRACTION).toFixed(4),
          });
        })
        .filter((instance) => this.policy.evaluate(instance, now).isWaste);

      return Result.ok(instances);
    } catch (err) {
      return Result.fail(new AwsAdapterError('RDS', err as Error));
    } finally {
      rds.destroy();
      cw.destroy();
    }
  }

  private async cpuStats(
    cw: CloudWatchClient,
    dbInstanceIdentifier: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<{ avg: number; max: number }> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/RDS',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbInstanceIdentifier }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Average', 'Maximum'],
      }),
    );
    const dp = r.Datapoints?.[0];
    return { avg: dp?.Average ?? 0, max: dp?.Maximum ?? 0 };
  }
}
