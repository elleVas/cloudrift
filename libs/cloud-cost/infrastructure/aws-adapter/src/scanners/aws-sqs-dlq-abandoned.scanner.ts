// SPDX-License-Identifier: Apache-2.0
import {
  SQSClient,
  ListQueuesCommand,
  GetQueueAttributesCommand,
  ListDeadLetterSourceQueuesCommand,
  ListQueueTagsCommand,
} from '@aws-sdk/client-sqs';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import type { AwsRegion } from 'cloud-cost-domain';
import { SqsDlqAbandoned, SqsDlqAbandonedWastePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { maxMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

// `ApproximateAgeOfOldestMessage` is a point-in-time gauge SQS publishes to
// CloudWatch every 5 minutes, not a rate that needs a long lookback to
// average out — unlike the idle scanners' windows (48h+, "was there any
// activity"), this window only needs to be wide enough to catch the most
// recent datapoint. The 14-day waste threshold itself lives in
// SqsDlqAbandonedWastePolicy, applied to whatever age this window returns.
const DEFAULT_LOOKBACK_HOURS = 24;
const ATTRIBUTE_CONCURRENCY = 5;

// Naming-convention fallback for the DLQ-identification signals GetQueueAttributes/
// ListDeadLetterSourceQueues can't cover on their own (see toDlqCandidate below).
// Exported so the scanner spec can predict whether a given fixture will reach
// the (conditional) ListQueueTags call, without duplicating the pattern.
export const DLQ_NAME_PATTERN = /(-dlq|-dead-letter|_dlq|_dead_letter)(-queue)?$/i;

interface DlqCandidate {
  queueUrl: string;
  queueName: string;
  approximateNumberOfMessages: number;
  sourceQueueArn?: string;
  tags: Record<string, string>;
}

function queueNameFromUrl(queueUrl: string): string {
  return queueUrl.slice(queueUrl.lastIndexOf('/') + 1);
}

/**
 * Detects SQS queues acting as Dead Letter Queues (identified via
 * RedriveAllowPolicy, an active RedrivePolicy association from another
 * queue, or a DLQ naming convention) holding messages nobody has consumed
 * in a while. $0 direct cost — SQS has no storage cost — the finding is a
 * hygiene flag (errors nobody is looking at), same reasoning as
 * `eni-orphaned`.
 */
export class AwsSqsDlqAbandonedScanner extends CloudWatchIdleScanner<SQSClient, DlqCandidate, number, SqsDlqAbandoned> {
  readonly kind = 'sqs-dlq-abandoned' as const;
  protected readonly serviceLabel = 'SQS';

  constructor(
    private readonly accountId = 'unknown',
    policy: WastePolicy<SqsDlqAbandoned> = new SqsDlqAbandonedWastePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): SQSClient {
    return new SQSClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: SQSClient): void {
    client.destroy();
  }

  protected async listResources(client: SQSClient, region: AwsRegion): Promise<DlqCandidate[]> {
    const queueUrls = await paginate<string>(async (cursor) => {
      const r = await client.send(new ListQueuesCommand({ NextToken: cursor }));
      return { items: r.QueueUrls ?? [], cursor: r.NextToken };
    });

    const candidates = await mapWithConcurrency(queueUrls, ATTRIBUTE_CONCURRENCY, (queueUrl) =>
      this.toDlqCandidate(client, queueUrl, region),
    );
    return candidates.filter((c): c is DlqCandidate => c !== null);
  }

  private async toDlqCandidate(client: SQSClient, queueUrl: string, region: AwsRegion): Promise<DlqCandidate | null> {
    const queueName = queueNameFromUrl(queueUrl);
    const [attrs, sourceQueueUrls] = await Promise.all([
      client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['All'] })),
      paginate<string>(async (cursor) => {
        const r = await client.send(
          new ListDeadLetterSourceQueuesCommand({ QueueUrl: queueUrl, NextToken: cursor }),
        );
        return { items: r.queueUrls ?? [], cursor: r.NextToken };
      }),
    ]);

    // Three independent DLQ-identification signals (ADR-0065/plan Task 2):
    // (a) this queue advertises itself as a valid redrive target,
    // (b) another queue's RedrivePolicy currently points at it (AWS already
    //     did the cross-reference for us), or (c) naming convention — the
    //     fallback for a DLQ whose source queue was already decommissioned,
    //     which is exactly the "abandoned" case this scanner exists to catch.
    const hasRedriveAllowPolicy = !!attrs.Attributes?.RedriveAllowPolicy;
    const hasActiveSource = sourceQueueUrls.length > 0;
    const matchesNamingConvention = DLQ_NAME_PATTERN.test(queueName);
    if (!hasRedriveAllowPolicy && !hasActiveSource && !matchesNamingConvention) return null;

    // Tags are only needed for a candidate that's actually a DLQ — deferred
    // until after the check above so a non-DLQ queue never pays for this call.
    const tagsResult = await client.send(new ListQueueTagsCommand({ QueueUrl: queueUrl }));

    // Only synthesize a real ARN when the account ID is actually known — with
    // the 'unknown' fallback (STS resolution failed) this would otherwise
    // present a malformed pseudo-ARN as if it were a real one.
    return {
      queueUrl,
      queueName,
      approximateNumberOfMessages: Number(attrs.Attributes?.ApproximateNumberOfMessages ?? '0'),
      sourceQueueArn:
        hasActiveSource && this.accountId !== 'unknown'
          ? `arn:aws:sqs:${region.code}:${this.accountId}:${queueNameFromUrl(sourceQueueUrls[0])}`
          : undefined,
      tags: tagsResult.Tags ?? {},
    };
  }

  protected fetchMetric(cw: CloudWatchClient, _region: AwsRegion, candidate: DlqCandidate, window: MetricWindow) {
    return maxMetric(
      cw,
      'AWS/SQS',
      'ApproximateAgeOfOldestMessage',
      [{ Name: 'QueueName', Value: candidate.queueName }],
      window,
    );
  }

  protected toEntity(
    candidate: DlqCandidate,
    oldestMessageAgeSeconds: number,
    _prices: Map<string, number>,
    region: AwsRegion,
    _now: Date,
  ): SqsDlqAbandoned {
    return new SqsDlqAbandoned({
      queueUrl: candidate.queueUrl,
      queueName: candidate.queueName,
      approximateNumberOfMessages: candidate.approximateNumberOfMessages,
      oldestMessageAgeSeconds,
      identifiedAsDlq: true,
      sourceQueueArn: candidate.sourceQueueArn,
      region,
      accountId: this.accountId,
      tags: candidate.tags,
    });
  }
}
