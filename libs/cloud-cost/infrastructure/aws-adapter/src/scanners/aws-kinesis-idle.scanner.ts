// SPDX-License-Identifier: Apache-2.0
import {
  KinesisClient,
  ListStreamsCommand,
  DescribeStreamSummaryCommand,
  type StreamDescriptionSummary,
} from '@aws-sdk/client-kinesis';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { KinesisStream, KinesisProvisionedIdleStreamPolicy, type WastePolicy } from 'cloud-cost-domain';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const DESCRIBE_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

type StreamWithName = StreamDescriptionSummary & { StreamName: string };

/**
 * Detects Kinesis Data Streams (Provisioned mode only — On-Demand bills per
 * use, out of scope per ADR-0038) with zero incoming activity in the
 * observed window. Billed per shard-hour at a single flat rate (no
 * per-type cardinality), so pricing is always-on (ADR-0037).
 */
export class AwsKinesisIdleScanner extends CloudWatchIdleScanner<
  KinesisClient,
  StreamWithName,
  number,
  KinesisStream
> {
  readonly kind = 'kinesis-provisioned-idle-stream' as const;
  protected readonly serviceLabel = 'Kinesis';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<KinesisStream> = new KinesisProvisionedIdleStreamPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours, DESCRIBE_CONCURRENCY);
  }

  protected createPrimaryClient(region: AwsRegion): KinesisClient {
    return new KinesisClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: KinesisClient): void {
    client.destroy();
  }

  protected async listResources(client: KinesisClient): Promise<StreamWithName[]> {
    const streamNames = await paginate<string>(async (cursor) => {
      const r = await client.send(new ListStreamsCommand(cursor ? { ExclusiveStartStreamName: cursor } : {}));
      const names = r.StreamNames ?? [];
      return { items: names, cursor: r.HasMoreStreams && names.length > 0 ? names[names.length - 1] : undefined };
    });

    const summaries = await mapWithConcurrency(streamNames, DESCRIBE_CONCURRENCY, async (name) => {
      const r = await client.send(new DescribeStreamSummaryCommand({ StreamName: name }));
      return r.StreamDescriptionSummary;
    });

    const named = summaries.filter((s): s is StreamWithName => !!s?.StreamName);
    if (named.length !== summaries.length) {
      logger.debug(`${this.kind}: skipped ${summaries.length - named.length} entries missing StreamName`);
    }
    return named.filter((s) => s.StreamModeDetails?.StreamMode === 'PROVISIONED');
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, s: StreamWithName, window: MetricWindow) {
    return sumMetrics(
      cw,
      'AWS/Kinesis',
      ['IncomingBytes', 'IncomingRecords'],
      [{ Name: 'StreamName', Value: s.StreamName }],
      window,
    );
  }

  protected toEntity(
    s: StreamWithName,
    incomingActivityLastWindow: number,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): KinesisStream {
    const openShardCount = s.OpenShardCount ?? 0;
    const shardPrice = this.pricing.getPrice(region, 'kinesis-shard');
    return new KinesisStream({
      streamName: s.StreamName,
      region,
      accountId: this.accountId,
      openShardCount,
      incomingActivityLastWindow,
      metricWindowHours: this.windowHours,
      streamCreationTimestamp: s.StreamCreationTimestamp ?? new Date(0),
      detectedAt: now,
      tags: {},
      monthlyCostUsd: +(shardPrice * openShardCount).toFixed(4),
    });
  }
}
