// SPDX-License-Identifier: Apache-2.0
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { OverprovisionedDynamoDbTable, DynamoDbOverprovisionedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_WINDOW_HOURS = 168;
const DESCRIBE_CONCURRENCY = 5;
const CLOUDWATCH_CONCURRENCY = 5;
/** Estimated saving from downsizing the provisioned capacity (advisory, to be verified). */
const RIGHTSIZE_SAVING_FRACTION = 0.5;

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
export class AwsDynamoDbOverprovisionedScanner implements WasteScannerPort {
  readonly kind = 'dynamodb-overprovisioned' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new DynamoDbOverprovisionedPolicy(),
    private readonly windowHours = DEFAULT_WINDOW_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const dynamodb = new DynamoDBClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const tableNames = await paginate<string>(async (cursor) => {
        const r = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName: cursor }));
        return { items: r.TableNames ?? [], cursor: r.LastEvaluatedTableName };
      });

      if (tableNames.length === 0) return Result.ok([]);

      const descriptions = await mapWithConcurrency(tableNames, DESCRIBE_CONCURRENCY, async (name) => {
        const r = await dynamodb.send(new DescribeTableCommand({ TableName: name }));
        return r.Table!;
      });

      const provisionedTables = descriptions.filter(isProvisioned);
      if (provisionedTables.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const consumed = await mapWithConcurrency(
        provisionedTables,
        CLOUDWATCH_CONCURRENCY,
        async (table) => {
          const [read, write] = await Promise.all([
            this.sumMetric(cw, table.TableName!, 'ConsumedReadCapacityUnits', startTime, endTime, periodSeconds),
            this.sumMetric(cw, table.TableName!, 'ConsumedWriteCapacityUnits', startTime, endTime, periodSeconds),
          ]);
          return { read, write };
        },
      );

      const rcuPrice = this.pricing.getDynamoDbRcuPricePerHour(region);
      const wcuPrice = this.pricing.getDynamoDbWcuPricePerHour(region);
      const now = new Date();

      const tables = provisionedTables
        .map((table, index) => {
          const rcu = table.ProvisionedThroughput?.ReadCapacityUnits ?? 0;
          const wcu = table.ProvisionedThroughput?.WriteCapacityUnits ?? 0;
          const monthlyProvisionedCost = (rcu * rcuPrice + wcu * wcuPrice) * 730;
          return new OverprovisionedDynamoDbTable({
            tableName: table.TableName!,
            region,
            accountId: this.accountId,
            readCapacityUnits: rcu,
            writeCapacityUnits: wcu,
            consumedReadCapacityUnits: consumed[index].read,
            consumedWriteCapacityUnits: consumed[index].write,
            windowDays: +(this.windowHours / 24).toFixed(1),
            creationDateTime: table.CreationDateTime ?? new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +(monthlyProvisionedCost * RIGHTSIZE_SAVING_FRACTION).toFixed(4),
          });
        })
        .filter((table) => this.policy.evaluate(table, now).isWaste);

      return Result.ok(tables);
    } catch (err) {
      return Result.fail(new AwsAdapterError('DynamoDB', err as Error));
    } finally {
      dynamodb.destroy();
      cw.destroy();
    }
  }

  private async sumMetric(
    cw: CloudWatchClient,
    tableName: string,
    metricName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/DynamoDB',
        MetricName: metricName,
        Dimensions: [{ Name: 'TableName', Value: tableName }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
