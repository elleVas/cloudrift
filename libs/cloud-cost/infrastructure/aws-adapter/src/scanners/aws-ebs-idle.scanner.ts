// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand, type Volume } from '@aws-sdk/client-ec2';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { IdleEbsVolume, EbsIdlePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const logger = createLogger('cloudrift:scanner');

interface EbsOps {
  readOps: number;
  writeOps: number;
}

type VolumeWithId = Volume & { VolumeId: string };

/**
 * Detects EBS volumes that are *attached* (in-use) but with no I/O in the
 * observed window: storage paid for an idle disk. Distinct from
 * `ebs-volume` (unattached volumes). For each volume it sums
 * `VolumeReadOps` + `VolumeWriteOps` from CloudWatch; the threshold/decision
 * belongs to the policy.
 */
export class AwsEbsIdleScanner extends CloudWatchIdleScanner<EC2Client, VolumeWithId, EbsOps, IdleEbsVolume> {
  readonly kind = 'ebs-idle' as const;
  protected readonly serviceLabel = 'EBS';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<IdleEbsVolume> = new EbsIdlePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EC2Client {
    return new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: EC2Client): void {
    client.destroy();
  }

  protected async listResources(client: EC2Client): Promise<VolumeWithId[]> {
    const volumes = await paginate<Volume>(async (cursor) => {
      const r = await client.send(
        new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['in-use'] }], NextToken: cursor }),
      );
      return { items: r.Volumes ?? [], cursor: r.NextToken };
    });
    const valid = volumes.filter((v): v is VolumeWithId => !!v.VolumeId);
    if (valid.length !== volumes.length) {
      logger.debug(`${this.kind}: skipped ${volumes.length - valid.length} entries missing VolumeId`);
    }
    return valid;
  }

  protected async fetchMetric(cw: CloudWatchClient, region: AwsRegion, v: VolumeWithId, window: MetricWindow): Promise<EbsOps> {
    const dimensions = [{ Name: 'VolumeId', Value: v.VolumeId }];
    const [readOps, writeOps] = await Promise.all([
      sumMetric(cw, 'AWS/EBS', 'VolumeReadOps', dimensions, window),
      sumMetric(cw, 'AWS/EBS', 'VolumeWriteOps', dimensions, window),
    ]);
    return { readOps, writeOps };
  }

  protected toEntity(
    v: VolumeWithId,
    ops: EbsOps,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): IdleEbsVolume {
    const volumeType = v.VolumeType ?? 'gp2';
    const sizeGb = v.Size ?? 0;
    const pricePerGb =
      this.pricing.getPrice(region, `ebs-${volumeType}`) || this.pricing.getPrice(region, 'ebs-gp3');
    return new IdleEbsVolume({
      volumeId: v.VolumeId,
      region,
      accountId: this.accountId,
      sizeGb,
      volumeType,
      attachedInstanceId: v.Attachments?.[0]?.InstanceId,
      readOps: ops.readOps,
      writeOps: ops.writeOps,
      metricWindowHours: this.windowHours,
      createTime: v.CreateTime ?? new Date(),
      detectedAt: now,
      tags: Object.fromEntries((v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +(pricePerGb * sizeGb).toFixed(4),
    });
  }
}
