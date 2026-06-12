import {
  EC2Client,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  type Snapshot,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { EbsSnapshotRepositoryPort, AwsRegion, PricingPort } from 'cloud-cost-domain';
import { EbsSnapshot } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsEbsSnapshotRepositoryAdapter implements EbsSnapshotRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
  ) {}

  async findOrphanSnapshots(
    region: AwsRegion,
  ): ReturnType<EbsSnapshotRepositoryPort['findOrphanSnapshots']> {
    const client = new EC2Client({ region: region.code });
    try {
      const [snapshots, volumes] = await Promise.all([
        paginate<Snapshot>(async (cursor) => {
          const r = await client.send(
            new DescribeSnapshotsCommand({ OwnerIds: ['self'], NextToken: cursor }),
          );
          return { items: r.Snapshots ?? [], cursor: r.NextToken };
        }),
        paginate<Volume>(async (cursor) => {
          const r = await client.send(new DescribeVolumesCommand({ NextToken: cursor }));
          return { items: r.Volumes ?? [], cursor: r.NextToken };
        }),
      ]);

      const existingVolumeIds = new Set(volumes.map((v) => v.VolumeId).filter(Boolean));
      const pricePerGb = this.pricing.getEbsSnapshotPricePerGbMonth(region);

      const orphans = snapshots
        .filter((snap: Snapshot) => snap.VolumeId && !existingVolumeIds.has(snap.VolumeId))
        .map(
          (snap: Snapshot) =>
            new EbsSnapshot({
              snapshotId: snap.SnapshotId!,
              region,
              accountId: this.accountId,
              sourceVolumeId: snap.VolumeId!,
              sizeGb: snap.VolumeSize ?? 0,
              startTime: snap.StartTime ?? new Date(0),
              detectedAt: new Date(),
              description: snap.Description ?? '',
              tags: Object.fromEntries(
                (snap.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
              ),
              monthlyCostUsd: +(pricePerGb * (snap.VolumeSize ?? 0)).toFixed(4),
            }),
        );

      return Result.ok(orphans);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
