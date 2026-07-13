// SPDX-License-Identifier: Apache-2.0
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { OverprovisionedDynamoDbTable, DynamoDbOverprovisionedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_WINDOW_HOURS = 168;
const logger = createLogger('cloudrift:scanner');
const DESCRIBE_CONCURRENCY = 5;
/** Estimated saving from downsizing the provisioned capacity (advisory, to be verified). */
const RIGHTSIZE_SAVING_FRACTION = 0.5;

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
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): DynamoDBClient {
    return new DynamoDBClient({ ...createAwsClientConfig(), region: region.code });
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
    const monthlyProvisionedCost = (rcu * rcuPrice + wcu * wcuPrice) * 730;
    return new OverprovisionedDynamoDbTable({
      tableName: table.TableName,
      region,
      accountId: this.accountId,
      readCapacityUnits: rcu,
      writeCapacityUnits: wcu,
      consumedReadCapacityUnits: consumed.read,
      consumedWriteCapacityUnits: consumed.write,
      windowDays: +(this.windowHours / 24).toFixed(1),
      creationDateTime: table.CreationDateTime ?? new Date(0),
      detectedAt: now,
      tags: {},
      monthlyCostUsd: +(monthlyProvisionedCost * RIGHTSIZE_SAVING_FRACTION).toFixed(4),
    });
  }
}
