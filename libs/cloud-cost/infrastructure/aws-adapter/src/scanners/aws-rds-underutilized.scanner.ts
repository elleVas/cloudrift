// SPDX-License-Identifier: Apache-2.0
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DBInstance,
} from '@aws-sdk/client-rds';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { RdsUnderutilizedInstance, RdsUnderutilizedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';
import { NON_RDS_ENGINES } from '../utils/non-rds-engines';
import { avgMaxMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { stepDownOneSize } from '../utils/instance-step-down';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_WINDOW_HOURS = 168;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

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
    credentials?: AwsCredentialIdentityProvider,
  ) {
    super(policy, windowHours, undefined, credentials);
  }

  protected createPrimaryClient(region: AwsRegion): RDSClient {
    return new RDSClient({ ...createAwsClientConfig(this.credentials), region: region.code });
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
      (db): db is DbInstanceWithId =>
        !!db.DBInstanceIdentifier &&
        db.DBInstanceStatus === 'available' &&
        !NON_RDS_ENGINES.has(db.Engine ?? ''),
    );
    if (valid.length !== instances.length) {
      logger.debug(`${this.kind}: skipped ${instances.length - valid.length} entries not available, non-RDS engine, or missing DBInstanceIdentifier`);
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
    // Resolve both the current spec and its one-size-down neighbor (if any):
    // the saving is a real price subtraction, so both prices must come from
    // the Pricing API, not just the current one.
    const currentSpecs = raw.map(priceSpecOf);
    const stepDownSpecs = currentSpecs
      .map((spec) => {
        const smaller = stepDownOneSize(spec.dbInstanceClass);
        return smaller ? { ...spec, dbInstanceClass: smaller } : null;
      })
      .filter((s): s is RdsPriceSpec => s !== null);
    const uniqueSpecs = [...new Map([...currentSpecs, ...stepDownSpecs].map((s) => [priceSpecKey(s), s])).values()];
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
    const spec = priceSpecOf(db);
    const currentPrice = prices.get(priceSpecKey(spec)) ?? 0;
    const stepDownClass = stepDownOneSize(spec.dbInstanceClass);
    const stepDownPrice = stepDownClass
      ? (prices.get(priceSpecKey({ ...spec, dbInstanceClass: stepDownClass })) ?? 0)
      : 0;
    // Both prices must have actually resolved (0 means "unpriced" here, no
    // RDS instance is genuinely free), and the smaller class must be
    // cheaper — otherwise there's no derivable number, so this reports $0
    // rather than a guess (see class doc).
    const hasRealSaving = stepDownClass !== null && currentPrice > 0 && stepDownPrice > 0 && currentPrice > stepDownPrice;
    return new RdsUnderutilizedInstance({
      dbInstanceIdentifier: db.DBInstanceIdentifier,
      region,
      accountId: this.accountId,
      dbInstanceClass: spec.dbInstanceClass,
      recommendedInstanceClass: hasRealSaving ? (stepDownClass ?? undefined) : undefined,
      engine: db.Engine ?? 'unknown',
      avgCpuPercent: cpu.avg,
      maxCpuPercent: cpu.max,
      windowDays: +(this.windowHours / 24).toFixed(1),
      instanceCreateTime: db.InstanceCreateTime ?? new Date(),
      detectedAt: now,
      tags: Object.fromEntries((db.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: hasRealSaving ? +(currentPrice - stepDownPrice).toFixed(4) : 0,
    });
  }
}
