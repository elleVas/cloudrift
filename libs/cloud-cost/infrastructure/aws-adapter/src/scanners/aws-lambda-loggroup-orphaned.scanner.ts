// SPDX-License-Identifier: Apache-2.0
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  type LogGroup as AwsLogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import { LambdaClient, ListFunctionsCommand, type FunctionConfiguration } from '@aws-sdk/client-lambda';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { LambdaLogGroupOrphaned, LambdaLogGroupOrphanedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const LOG_GROUP_PREFIX = '/aws/lambda/';
// Only orphan candidates pay for a DescribeLogStreams call — the (usually
// much larger) set of log groups whose function still exists never does.
const STREAM_LOOKUP_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

type LogGroupWithName = AwsLogGroup & { logGroupName: string };

/**
 * Detects `/aws/lambda/*` CloudWatch Log Groups whose function no longer
 * exists — distinct from the `log-group` scanner, which flags missing
 * retention on log groups that still belong to a live function.
 */
export class AwsLambdaLogGroupOrphanedScanner implements WasteScannerPort {
  readonly kind = 'lambda-loggroup-orphaned' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new LambdaLogGroupOrphanedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const logsClient = new CloudWatchLogsClient({ ...createAwsClientConfig(), region: region.code });
    const lambdaClient = new LambdaClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const [rawLogGroups, functions] = await Promise.all([
        paginate<AwsLogGroup>(async (cursor) => {
          const r = await logsClient.send(
            new DescribeLogGroupsCommand({ logGroupNamePrefix: LOG_GROUP_PREFIX, nextToken: cursor }),
          );
          return { items: r.logGroups ?? [], cursor: r.nextToken };
        }),
        paginate<FunctionConfiguration>(async (cursor) => {
          const r = await lambdaClient.send(new ListFunctionsCommand({ Marker: cursor }));
          return { items: r.Functions ?? [], cursor: r.NextMarker };
        }),
      ]);

      const validGroups = rawLogGroups.filter((lg): lg is LogGroupWithName => !!lg.logGroupName);
      if (validGroups.length !== rawLogGroups.length) {
        logger.debug(`${this.kind}: skipped ${rawLogGroups.length - validGroups.length} entries missing logGroupName`);
      }
      const activeFunctionNames = new Set(functions.map((fn) => fn.FunctionName).filter((n): n is string => !!n));
      const orphanCandidates = validGroups.filter(
        (lg) => !activeFunctionNames.has(lg.logGroupName.slice(LOG_GROUP_PREFIX.length)),
      );

      const pricePerGb = this.pricing.getPrice(region, 'cw-logs');
      const now = new Date();
      const entities = await mapWithConcurrency(orphanCandidates, STREAM_LOOKUP_CONCURRENCY, async (lg) => {
        const lastEventTimestamp = await this.lastEventTimestamp(logsClient, lg.logGroupName);
        const storedBytes = lg.storedBytes ?? 0;
        return new LambdaLogGroupOrphaned({
          logGroupName: lg.logGroupName,
          functionName: lg.logGroupName.slice(LOG_GROUP_PREFIX.length),
          functionExists: false,
          storedBytes,
          lastEventTimestamp,
          region,
          accountId: this.accountId,
          tags: {},
          monthlyCostUsd: +((storedBytes / 1024 ** 3) * pricePerGb).toFixed(4),
          detectedAt: now,
        });
      });

      return Result.ok(entities.filter((group) => this.policy.evaluate(group, now).isWaste));
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatchLogs', err as Error));
    } finally {
      logsClient.destroy();
      lambdaClient.destroy();
    }
  }

  /** `null` when the log group has no log stream, or a stream with no events (never logged) — not the same as "logged long ago". */
  private async lastEventTimestamp(client: CloudWatchLogsClient, logGroupName: string): Promise<Date | null> {
    const r = await client.send(
      new DescribeLogStreamsCommand({ logGroupName, orderBy: 'LastEventTime', descending: true, limit: 1 }),
    );
    const timestamp = r.logStreams?.[0]?.lastEventTimestamp;
    return timestamp ? new Date(timestamp) : null;
  }
}
