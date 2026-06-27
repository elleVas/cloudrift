// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeTransitGatewayAttachmentsCommand,
  type TransitGatewayAttachment as SdkTransitGatewayAttachment,
} from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { TransitGatewayAttachment, TransitGatewayIdleAttachmentPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Detects Transit Gateway attachments with zero traffic in the observed
 * window. Billed per attachment-hour regardless of traffic, with a single
 * flat rate (no per-type cardinality), so pricing is always-on (ADR-0037).
 */
export class AwsTransitGatewayIdleScanner implements WasteScannerPort {
  readonly kind = 'transit-gateway-idle-attachment' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new TransitGatewayIdleAttachmentPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const ec2 = new EC2Client({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const attachments = await paginate<SdkTransitGatewayAttachment>(async (cursor) => {
        const r = await ec2.send(
          new DescribeTransitGatewayAttachmentsCommand({
            Filters: [{ Name: 'state', Values: ['available'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.TransitGatewayAttachments ?? [], cursor: r.NextToken };
      });

      if (attachments.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const bytes = await mapWithConcurrency(attachments, CLOUDWATCH_CONCURRENCY, (a) =>
        this.sumBytes(cw, a.TransitGatewayId!, a.TransitGatewayAttachmentId!, startTime, endTime, periodSeconds),
      );

      const monthlyCostUsd = this.pricing.getTransitGatewayAttachmentPricePerMonth(region);
      const now = new Date();
      const idle = attachments
        .map(
          (a, index) =>
            new TransitGatewayAttachment({
              transitGatewayAttachmentId: a.TransitGatewayAttachmentId!,
              region,
              accountId: this.accountId,
              transitGatewayId: a.TransitGatewayId ?? 'unknown',
              resourceType: a.ResourceType ?? 'unknown',
              bytesLastWindow: bytes[index],
              metricWindowHours: this.windowHours,
              creationTime: a.CreationTime ?? new Date(0),
              detectedAt: now,
              tags: Object.fromEntries((a.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
              monthlyCostUsd,
            }),
        )
        .filter((a) => this.policy.evaluate(a, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('TransitGateway', err as Error));
    } finally {
      ec2.destroy();
      cw.destroy();
    }
  }

  private async sumBytes(
    cw: CloudWatchClient,
    transitGatewayId: string,
    attachmentId: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const [bytesIn, bytesOut] = await Promise.all(
      ['BytesIn', 'BytesOut'].map((metricName) =>
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/TransitGateway',
            MetricName: metricName,
            Dimensions: [
              { Name: 'TransitGateway', Value: transitGatewayId },
              { Name: 'TransitGatewayAttachment', Value: attachmentId },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: ['Sum'],
          }),
        ),
      ),
    );
    return (bytesIn.Datapoints?.[0]?.Sum ?? 0) + (bytesOut.Datapoints?.[0]?.Sum ?? 0);
  }
}
