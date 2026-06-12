import {
  EC2Client,
  DescribeVolumesCommand,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type {
  EbsVolumeRepositoryPort,
  AwsRegion,
  EbsVolumeState,
  PricingPort,
} from 'cloud-cost-domain';
import { EbsVolume } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsEbsVolumeRepositoryAdapter implements EbsVolumeRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
  ) {}

  async findUnattachedVolumes(
    region: AwsRegion,
  ): ReturnType<EbsVolumeRepositoryPort['findUnattachedVolumes']> {
    const client = new EC2Client({ region: region.code });
    try {
      const rawVolumes = await paginate<Volume>(async (cursor) => {
        const r = await client.send(
          new DescribeVolumesCommand({
            Filters: [{ Name: 'status', Values: ['available'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.Volumes ?? [], cursor: r.NextToken };
      });

      const volumes = rawVolumes.map((v: Volume) => {
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
          detectedAt: new Date(),
          tags: Object.fromEntries(
            (v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
          ),
          monthlyCostUsd: +(pricePerGb * v.Size!).toFixed(4),
        });
      });

      return Result.ok(volumes);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EBS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
