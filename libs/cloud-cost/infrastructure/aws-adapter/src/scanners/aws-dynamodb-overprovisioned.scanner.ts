// SPDX-License-Identifier: Apache-2.0
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { OverprovisionedDynamoDbTable, DynamoDbOverprovisionedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_WINDOW_HOURS = 168;
const logger = createLogger('cloudrift:scanner');
const DESCRIBE_CONCURRENCY = 5;
/** DynamoDB provisioned mode requires at least 1 RCU/WCU — never recommend 0. */
const MIN_RECOMMENDED_CAPACITY_UNITS = 1;
/**
 * CloudWatch is queried for a single aggregate Sum over the whole window
 * (see `fetchMetric`/`sumMetric`), not per-period datapoints, so there's no
 * true peak signal here — only an average consumed rate. This multiplier is
 * a conservative stand-in headroom over that average, applied before
 * recommending a downsize, to avoid under-provisioning a table with bursty
 * traffic the average alone wouldn't show.
 */
const AVERAGE_TO_HEADROOM_MULTIPLIER = 3;

interface ConsumedCapacity {
  read: number;
  write: number;
}

type TableWithName = TableDescription & { TableName: string };

function isProvisioned(table: TableDescription): boolean {
  if (table.BillingModeSummary?.BillingMode) {
    return table.BillingModeSummary.BillingMode === 'PROVISIONED';
  }
  return (table.ProvisionedThroughput?.ReadCapacityUnits ?? 0) > 0;
}

/**
 * Detects DynamoDB tables in PROVISIONED mode with consumed RCU/WCU
 * capacity well below the allocated one. `ListTables` only returns the
 * names: a `DescribeTable` per table (fan-out) is needed to read the
 * provisioned capacity, then CloudWatch for the consumed one.
 */
export class AwsDynamoDbOverprovisionedScanner extends CloudWatchIdleScanner<
  DynamoDBClient,
  TableWithName,
  ConsumedCapacity,
  OverprovisionedDynamoDbTable
> {
  readonly kind = 'dynamodb-overprovisioned' as const;
  protected readonly serviceLabel = 'DynamoDB';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<OverprovisionedDynamoDbTable> = new DynamoDbOverprovisionedPolicy(),
    windowHours = DEFAULT_WINDOW_HOURS,
    credentials?: AwsCredentialIdentityProvider,
  ) {
    super(policy, windowHours, undefined, credentials);
  }

  protected createPrimaryClient(region: AwsRegion): DynamoDBClient {
    return new DynamoDBClient({ ...createAwsClientConfig(this.credentials), region: region.code });
  }

  protected destroyPrimaryClient(client: DynamoDBClient): void {
    client.destroy();
  }

  protected async listResources(client: DynamoDBClient): Promise<TableWithName[]> {
    const tableNames = await paginate<string>(async (cursor) => {
      const r = await client.send(new ListTablesCommand({ ExclusiveStartTableName: cursor }));
      return { items: r.TableNames ?? [], cursor: r.LastEvaluatedTableName };
    });

    const descriptions = await mapWithConcurrency(tableNames, DESCRIBE_CONCURRENCY, async (name) => {
      const r = await client.send(new DescribeTableCommand({ TableName: name }));
      return r.Table;
    });

    const named = descriptions.filter((t): t is TableWithName => !!t?.TableName);
    if (named.length !== descriptions.length) {
      logger.debug(`${this.kind}: skipped ${descriptions.length - named.length} entries missing Table/TableName`);
    }
    return named.filter(isProvisioned);
  }

  protected async fetchMetric(
    cw: CloudWatchClient,
    region: AwsRegion,
    table: TableWithName,
    window: MetricWindow,
  ): Promise<ConsumedCapacity> {
    const dimensions = [{ Name: 'TableName', Value: table.TableName }];
    const [read, write] = await Promise.all([
      sumMetric(cw, 'AWS/DynamoDB', 'ConsumedReadCapacityUnits', dimensions, window),
      sumMetric(cw, 'AWS/DynamoDB', 'ConsumedWriteCapacityUnits', dimensions, window),
    ]);
    return { read, write };
  }

  /** Recommended capacity: average consumed rate × headroom, floored at the minimum, capped at the current allocation (never recommends an increase). */
  private recommendCapacity(consumedUnits: number, currentUnits: number, windowSeconds: number): number {
    const avgPerSecond = consumedUnits / windowSeconds;
    const recommended = Math.ceil(avgPerSecond * AVERAGE_TO_HEADROOM_MULTIPLIER);
    return Math.min(currentUnits, Math.max(MIN_RECOMMENDED_CAPACITY_UNITS, recommended));
  }

  protected toEntity(
    table: TableWithName,
    consumed: ConsumedCapacity,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): OverprovisionedDynamoDbTable {
    const rcu = table.ProvisionedThroughput?.ReadCapacityUnits ?? 0;
    const wcu = table.ProvisionedThroughput?.WriteCapacityUnits ?? 0;
    const rcuPrice = this.pricing.getPrice(region, 'dynamodb-rcu');
    const wcuPrice = this.pricing.getPrice(region, 'dynamodb-wcu');
    const windowSeconds = this.windowHours * 3600;
    const recommendedRcu = this.recommendCapacity(consumed.read, rcu, windowSeconds);
    const recommendedWcu = this.recommendCapacity(consumed.write, wcu, windowSeconds);
    const monthlySaving = (rcu - recommendedRcu) * rcuPrice * 730 + (wcu - recommendedWcu) * wcuPrice * 730;
    return new OverprovisionedDynamoDbTable({
      tableName: table.TableName,
      region,
      accountId: this.accountId,
      readCapacityUnits: rcu,
      writeCapacityUnits: wcu,
      consumedReadCapacityUnits: consumed.read,
      consumedWriteCapacityUnits: consumed.write,
      recommendedReadCapacityUnits: recommendedRcu,
      recommendedWriteCapacityUnits: recommendedWcu,
      windowDays: +(this.windowHours / 24).toFixed(1),
      creationDateTime: table.CreationDateTime ?? new Date(0),
      detectedAt: now,
      tags: {},
      monthlyCostUsd: +Math.max(0, monthlySaving).toFixed(4),
    });
  }
}
