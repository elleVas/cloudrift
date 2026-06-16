import {
  EC2Client,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  DescribeImagesCommand,
  type Image,
  type Snapshot,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { EbsSnapshot, EbsSnapshotWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsEbsSnapshotScanner implements WasteScannerPort {
  readonly kind = 'ebs-snapshot' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EbsSnapshotWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ region: region.code });
    try {
      // Tre sorgenti in parallelo: snapshot, volumi esistenti e AMI registrate
      // (gli snapshot referenziati da un'AMI non sono cancellabili).
      const [snapshots, volumes, images] = await Promise.all([
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
        paginate<Image>(async (cursor) => {
          const r = await client.send(
            new DescribeImagesCommand({ Owners: ['self'], NextToken: cursor }),
          );
          return { items: r.Images ?? [], cursor: r.NextToken };
        }),
      ]);

      const existingVolumeIds = new Set(volumes.map((v) => v.VolumeId).filter(Boolean));
      const snapshotToAmi = new Map<string, string>();
      for (const image of images) {
        for (const bdm of image.BlockDeviceMappings ?? []) {
          if (bdm.Ebs?.SnapshotId && image.ImageId) {
            snapshotToAmi.set(bdm.Ebs.SnapshotId, image.ImageId);
          }
        }
      }

      const pricePerGb = this.pricing.getEbsSnapshotPricePerGbMonth(region);
      const now = new Date();

      const orphans = snapshots
        .filter((snap: Snapshot) => !!snap.VolumeId)
        .map(
          (snap: Snapshot) =>
            new EbsSnapshot({
              snapshotId: snap.SnapshotId!,
              region,
              accountId: this.accountId,
              sourceVolumeId: snap.VolumeId!,
              sourceVolumeExists: existingVolumeIds.has(snap.VolumeId),
              boundToAmiId: snapshotToAmi.get(snap.SnapshotId ?? ''),
              sizeGb: snap.VolumeSize ?? 0,
              startTime: snap.StartTime ?? new Date(0),
              detectedAt: now,
              description: snap.Description ?? '',
              tags: Object.fromEntries(
                (snap.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
              ),
              monthlyCostUsd: +(pricePerGb * (snap.VolumeSize ?? 0)).toFixed(4),
            }),
        )
        .filter((snapshot) => this.policy.evaluate(snapshot, now).isWaste);

      return Result.ok(orphans);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
