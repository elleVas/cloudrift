import {
  EC2Client,
  DescribeVolumesCommand,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type {
  AwsRegion,
  EbsVolumeState,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { EbsVolume, EbsVolumeWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsEbsVolumeScanner implements WasteScannerPort {
  readonly kind = 'ebs-volume' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EbsVolumeWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ region: region.code });
    try {
      // Server-side prefilter: 'available' volumes are the superset of
      // candidates; the final decision (grace period, tag) is up to the policy.
      const rawVolumes = await paginate<Volume>(async (cursor) => {
        const r = await client.send(
          new DescribeVolumesCommand({
            Filters: [{ Name: 'status', Values: ['available'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.Volumes ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const volumes = rawVolumes
        .map((v: Volume) => {
          const volumeType = v.VolumeType ?? 'gp2';
          const pricePerGb = this.pricing.getEbsVolumePricePerGbMonth(region, volumeType);
          return new EbsVolume({
            volumeId: v.VolumeId!,
            region,
            accountId: this.accountId,
            sizeGb: v.Size!,
            volumeType,
            state: v.State as EbsVolumeState,
            createTime: v.CreateTime ?? new Date(),
            detectedAt: now,
            tags: Object.fromEntries(
              (v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(pricePerGb * v.Size!).toFixed(4),
          });
        })
        .filter((volume) => this.policy.evaluate(volume, now).isWaste);

      return Result.ok(volumes);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EBS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
