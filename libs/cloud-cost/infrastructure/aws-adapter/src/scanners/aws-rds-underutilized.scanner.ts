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

const DEFAULT_WINDOW_DAYS = 14;
const CLOUDWATCH_CONCURRENCY = 5;
const PRICING_CONCURRENCY = 5;
/** Risparmio stimato da un downsize di un tier (advisory, da verificare). */
const RIGHTSIZE_SAVING_FRACTION = 0.5;

/**
 * Il prezzo per classe di istanza RDS è risolto on-demand dalla Pricing API
 * (la cardinalità di classe × engine × deployment è troppo alta per il
 * listino statico/il prefetch di `warmUp`): `AwsPricingApiAdapter` soddisfa
 * questa interfaccia per duck typing.
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
 * Rileva istanze RDS *available* con CPU massima sotto soglia sull'intera
 * finestra di osservazione: probabile sovradimensionamento. Advisory
 * (categoria optimization, stima): CPU bassa non garantisce che storage I/O
 * o connessioni siano altrettanto sottoutilizzati, va verificato prima di un
 * rightsizing. Disgiunto da `rds-instance` (quello rileva le istanze
 * `stopped`). Richiede `--live-pricing`: senza un prezzo per classe di
 * istanza, non c'è risparmio stimabile.
 */
export class AwsRdsUnderutilizedScanner implements WasteScannerPort {
  readonly kind = 'rds-underutilized' as const;

  constructor(
    private readonly pricing: RdsInstancePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new RdsUnderutilizedPolicy(),
    private readonly windowDays = DEFAULT_WINDOW_DAYS,
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
      const startTime = new Date(endTime.getTime() - this.windowDays * 24 * 60 * 60 * 1000);
      const periodSeconds = this.windowDays * 24 * 3600;

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
            windowDays: this.windowDays,
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
