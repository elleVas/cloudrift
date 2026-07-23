// SPDX-License-Identifier: Apache-2.0
import { CloudWatchClient, DescribeAlarmsCommand, type MetricAlarm } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { CloudwatchAlarmOrphaned, CloudwatchAlarmOrphanedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

type MetricAlarmWithId = MetricAlarm & { AlarmArn: string; AlarmName: string; AlarmConfigurationUpdatedTimestamp: Date };

/**
 * Detects CloudWatch alarms stuck in `INSUFFICIENT_DATA` — usually a sign
 * the metric's underlying resource (an instance, a queue, a table) was
 * deleted and nothing ever cleaned up the alarm watching it. `StateValue`
 * filters server-side on `DescribeAlarmsCommand`. `AlarmConfigurationUpdatedTimestamp`
 * stands in for a creation date the API doesn't expose — see the entity's
 * doc comment. `DescribeAlarms` doesn't return tags inline, so `tags` is
 * always `{}`.
 */
export class AwsCloudwatchAlarmOrphanedScanner implements DeadResourceScannerPort {
  readonly kind = 'cloudwatch-alarm-orphaned' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new CloudwatchAlarmOrphanedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new CloudWatchClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawAlarms = await paginate<MetricAlarm>(async (cursor) => {
        const r = await client.send(new DescribeAlarmsCommand({ StateValue: 'INSUFFICIENT_DATA', NextToken: cursor }));
        return { items: r.MetricAlarms ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validAlarms = rawAlarms.filter(
        (a): a is MetricAlarmWithId => !!a.AlarmArn && !!a.AlarmName && !!a.AlarmConfigurationUpdatedTimestamp,
      );

      const results = validAlarms
        .map(
          (a) =>
            new CloudwatchAlarmOrphaned({
              alarmArn: a.AlarmArn,
              alarmName: a.AlarmName,
              region,
              accountId: this.accountId,
              createdAt: a.AlarmConfigurationUpdatedTimestamp,
              detectedAt: now,
              tags: {},
            }),
        )
        .filter((a) => this.policy.evaluate(a, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudWatch', err as Error));
    } finally {
      client.destroy();
    }
  }
}
