// SPDX-License-Identifier: Apache-2.0
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  type LogGroup as AwsLogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { LogGroup, LogGroupWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type LogGroupWithName = AwsLogGroup & { logGroupName: string };

export class AwsLogGroupScanner implements WasteScannerPort {
  readonly kind = 'log-group' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new LogGroupWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new CloudWatchLogsClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
    try {
      const pricePerGb = this.pricing.getPrice(region, 'cw-logs');
      const now = new Date();
      let skipped = 0;

      // Filtered/mapped per page instead of accumulated raw: accounts with tens
      // of thousands of log groups only keep the (usually much smaller) wasted
      // subset in memory, not every group fetched.
      const groups = await paginate<AwsLogGroup, LogGroup>(
        async (cursor) => {
          const r = await client.send(new DescribeLogGroupsCommand({ nextToken: cursor }));
          return { items: r.logGroups ?? [], cursor: r.nextToken };
        },
        (page) => {
          const validGroups = page.filter((lg): lg is LogGroupWithName => !!lg.logGroupName);
          skipped += page.length - validGroups.length;
          return validGroups
            .map((lg) => {
              const storedBytes = lg.storedBytes ?? 0;
              return new LogGroup({
                logGroupName: lg.logGroupName,
                region,
                accountId: this.accountId,
                storedBytes,
                retentionInDays: lg.retentionInDays,
                creationTime: lg.creationTime ? new Date(lg.creationTime) : new Date(0),
                detectedAt: now,
                tags: {},
                monthlyCostUsd: +((storedBytes / 1024 ** 3) * pricePerGb).toFixed(4),
              });
            })
            .filter((group) => this.policy.evaluate(group, now).isWaste);
        },
      );

      if (skipped > 0) {
        logger.debug(`${this.kind}: skipped ${skipped} entries missing logGroupName`);
      }

      return Result.ok(groups);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatchLogs', err as Error));
    } finally {
      client.destroy();
    }
  }
}
