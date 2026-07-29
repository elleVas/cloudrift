// SPDX-License-Identifier: Apache-2.0
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  type LogGroup as AwsLogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { LogGroup, LogGroupWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

type LogGroupWithName = AwsLogGroup & { logGroupName: string };

export class AwsLogGroupScanner implements WasteScannerPort {
  readonly kind = 'log-group' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new LogGroupWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new CloudWatchLogsClient({ ...createAwsClientConfig(this.credentials), region: region.code });
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
              const props = {
                logGroupName: lg.logGroupName,
                region,
                accountId: this.accountId,
                storedBytes,
                retentionInDays: lg.retentionInDays,
                creationTime: lg.creationTime ? new Date(lg.creationTime) : new Date(0),
                detectedAt: now,
                tags: {},
                monthlyCostUsd: +((storedBytes / 1024 ** 3) * pricePerGb).toFixed(4),
              };
              const verdict = this.policy.evaluate(new LogGroup({ ...props, wasteReason: '' }), now);
              return verdict.isWaste ? new LogGroup({ ...props, wasteReason: verdict.reason }) : null;
            })
            .filter((group): group is LogGroup => group !== null);
        },
      );

      if (skipped > 0) {
        logger.debug(`${this.kind}: skipped ${skipped} entries missing logGroupName`);
      }

      return Result.ok(groups);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatchLogs', err));
    } finally {
      client.destroy();
    }
  }
}
