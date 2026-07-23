// SPDX-License-Identifier: Apache-2.0
import { CloudWatchLogsClient, DescribeLogGroupsCommand, type LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { LogsLogGroupEmpty, LogsLogGroupEmptyPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

type LogGroupWithId = LogGroup & { arn: string; logGroupName: string; creationTime: number };

/**
 * Detects CloudWatch log groups that have never stored any events
 * (`storedBytes === 0`). `DescribeLogGroups` doesn't return tags inline
 * (would need a separate `ListTagsForResource` call per group), so `tags`
 * is always `{}`.
 */
export class AwsLogsLogGroupEmptyScanner implements DeadResourceScannerPort {
  readonly kind = 'logs-loggroup-empty' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new LogsLogGroupEmptyPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new CloudWatchLogsClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawGroups = await paginate<LogGroup>(async (cursor) => {
        const r = await client.send(new DescribeLogGroupsCommand({ nextToken: cursor }));
        return { items: r.logGroups ?? [], cursor: r.nextToken };
      });

      const now = new Date();
      const validGroups = rawGroups.filter(
        (g): g is LogGroupWithId => !!g.arn && !!g.logGroupName && g.creationTime !== undefined,
      );

      const results = validGroups
        .filter((g) => (g.storedBytes ?? 0) === 0)
        .map(
          (g) =>
            new LogsLogGroupEmpty({
              arn: g.arn,
              logGroupName: g.logGroupName,
              region,
              accountId: this.accountId,
              createdAt: new Date(g.creationTime),
              detectedAt: now,
              tags: {},
            }),
        )
        .filter((g) => this.policy.evaluate(g, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatchLogs', err as Error));
    } finally {
      client.destroy();
    }
  }
}
