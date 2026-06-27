// SPDX-License-Identifier: Apache-2.0
import { KinesisClient, ListStreamsCommand, DescribeStreamSummaryCommand } from '@aws-sdk/client-kinesis';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { KinesisStream, KinesisProvisionedIdleStreamPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const DESCRIBE_CONCURRENCY = 5;

/**
 * Detects Kinesis Data Streams (Provisioned mode only — On-Demand bills per
 * use, out of scope per ADR-0038) with zero incoming activity in the
 * observed window. Billed per shard-hour at a single flat rate (no
 * per-type cardinality), so pricing is always-on (ADR-0037).
 */
export class AwsKinesisIdleScanner implements WasteScannerPort {
  readonly kind = 'kinesis-provisioned-idle-stream' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new KinesisProvisionedIdleStreamPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const kinesis = new KinesisClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const streamNames = await paginate<string>(async (cursor) => {
        const r = await kinesis.send(
          new ListStreamsCommand(cursor ? { ExclusiveStartStreamName: cursor } : {}),
        );
        const names = r.StreamNames ?? [];
        return { items: names, cursor: r.HasMoreStreams && names.length > 0 ? names[names.length - 1] : undefined };
      });

      if (streamNames.length === 0) return Result.ok([]);

      const summaries = await mapWithConcurrency(streamNames, DESCRIBE_CONCURRENCY, async (name) => {
        const r = await kinesis.send(new DescribeStreamSummaryCommand({ StreamName: name }));
        return r.StreamDescriptionSummary;
      });

      const provisioned = summaries.filter(
        (s): s is NonNullable<typeof s> => s?.StreamModeDetails?.StreamMode === 'PROVISIONED',
      );
      if (provisioned.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const activity = await mapWithConcurrency(provisioned, DESCRIBE_CONCURRENCY, (s) =>
        this.sumIncomingActivity(cw, s.StreamName!, startTime, endTime, periodSeconds),
      );

      const shardPrice = this.pricing.getKinesisShardPricePerMonth(region);
      const now = new Date();
      const idle = provisioned
        .map((s, index) => {
          const openShardCount = s.OpenShardCount ?? 0;
          return new KinesisStream({
            streamName: s.StreamName!,
            region,
            accountId: this.accountId,
            openShardCount,
            incomingActivityLastWindow: activity[index],
            metricWindowHours: this.windowHours,
            streamCreationTimestamp: s.StreamCreationTimestamp ?? new Date(0),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +(shardPrice * openShardCount).toFixed(4),
          });
        })
        .filter((s) => this.policy.evaluate(s, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Kinesis', err as Error));
    } finally {
      kinesis.destroy();
      cw.destroy();
    }
  }

  private async sumIncomingActivity(
    cw: CloudWatchClient,
    streamName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const [bytes, records] = await Promise.all(
      ['IncomingBytes', 'IncomingRecords'].map((metricName) =>
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/Kinesis',
            MetricName: metricName,
            Dimensions: [{ Name: 'StreamName', Value: streamName }],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: ['Sum'],
          }),
        ),
      ),
    );
    return (bytes.Datapoints?.[0]?.Sum ?? 0) + (records.Datapoints?.[0]?.Sum ?? 0);
  }
}
