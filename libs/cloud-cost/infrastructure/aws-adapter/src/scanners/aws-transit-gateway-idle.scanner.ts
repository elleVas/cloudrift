// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeTransitGatewayAttachmentsCommand,
  type TransitGatewayAttachment as SdkTransitGatewayAttachment,
} from '@aws-sdk/client-ec2';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { TransitGatewayAttachment, TransitGatewayIdleAttachmentPolicy, type WastePolicy } from 'cloud-cost-domain';
import { createAwsClientConfig } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const logger = createLogger('cloudrift:scanner');

type AttachmentWithIds = SdkTransitGatewayAttachment & {
  TransitGatewayId: string;
  TransitGatewayAttachmentId: string;
};

/**
 * Detects Transit Gateway attachments with zero traffic in the observed
 * window. Billed per attachment-hour regardless of traffic, with a single
 * flat rate (no per-type cardinality), so pricing is always-on (ADR-0037).
 */
export class AwsTransitGatewayIdleScanner extends CloudWatchIdleScanner<
  EC2Client,
  AttachmentWithIds,
  number,
  TransitGatewayAttachment
> {
  readonly kind = 'transit-gateway-idle-attachment' as const;
  protected readonly serviceLabel = 'TransitGateway';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<TransitGatewayAttachment> = new TransitGatewayIdleAttachmentPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EC2Client {
    return new EC2Client({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: EC2Client): void {
    client.destroy();
  }

  protected async listResources(client: EC2Client): Promise<AttachmentWithIds[]> {
    const attachments = await paginate<SdkTransitGatewayAttachment>(async (cursor) => {
      const r = await client.send(
        new DescribeTransitGatewayAttachmentsCommand({
          Filters: [{ Name: 'state', Values: ['available'] }],
          NextToken: cursor,
        }),
      );
      return { items: r.TransitGatewayAttachments ?? [], cursor: r.NextToken };
    });
    const valid = attachments.filter(
      (a): a is AttachmentWithIds => !!a.TransitGatewayId && !!a.TransitGatewayAttachmentId,
    );
    if (valid.length !== attachments.length) {
      logger.debug(
        `${this.kind}: skipped ${attachments.length - valid.length} entries missing TransitGatewayId/TransitGatewayAttachmentId`,
      );
    }
    return valid;
  }

  protected fetchMetric(
    cw: CloudWatchClient,
    region: AwsRegion,
    a: AttachmentWithIds,
    window: MetricWindow,
  ) {
    return sumMetrics(
      cw,
      'AWS/TransitGateway',
      ['BytesIn', 'BytesOut'],
      [
        { Name: 'TransitGateway', Value: a.TransitGatewayId },
        { Name: 'TransitGatewayAttachment', Value: a.TransitGatewayAttachmentId },
      ],
      window,
    );
  }

  protected toEntity(
    a: AttachmentWithIds,
    bytesLastWindow: number,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): TransitGatewayAttachment {
    return new TransitGatewayAttachment({
      transitGatewayAttachmentId: a.TransitGatewayAttachmentId,
      region,
      accountId: this.accountId,
      transitGatewayId: a.TransitGatewayId,
      resourceType: a.ResourceType ?? 'unknown',
      bytesLastWindow,
      metricWindowHours: this.windowHours,
      creationTime: a.CreationTime ?? new Date(0),
      detectedAt: now,
      tags: Object.fromEntries((a.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: this.pricing.getPrice(region, 'transit-gateway-attachment'),
    });
  }
}
