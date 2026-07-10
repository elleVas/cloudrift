// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  DescribeImagesCommand,
  type Image,
  type Snapshot,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { EbsSnapshot, EbsSnapshotWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type SnapshotWithIds = Snapshot & { SnapshotId: string; VolumeId: string };

export class AwsEbsSnapshotScanner implements WasteScannerPort {
  readonly kind = 'ebs-snapshot' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EbsSnapshotWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
    try {
      // Volumes and images are correlation sets: a snapshot can only be judged
      // "orphaned" once we know for certain no volume/AMI references it anywhere
      // — a false "orphan" would slip through if we judged against a partial set
      // while later pages are still in flight. Both are fetched in full (in
      // parallel with each other) before snapshots are touched.
      const [volumes, images] = await Promise.all([
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

      const pricePerGb = this.pricing.getPrice(region, 'ebs-snapshot');
      const now = new Date();
      let skipped = 0;

      // Snapshots are the unbounded side (can reach tens of thousands on
      // long-lived accounts), so they're judged and filtered per page instead
      // of accumulated whole — memory stays bounded by the orphan count, not
      // by the total snapshot count.
      const orphans = await paginate<Snapshot, EbsSnapshot>(
        async (cursor) => {
          const r = await client.send(
            new DescribeSnapshotsCommand({ OwnerIds: ['self'], NextToken: cursor }),
          );
          return { items: r.Snapshots ?? [], cursor: r.NextToken };
        },
        (page) => {
          const validSnapshots = page.filter(
            (snap): snap is SnapshotWithIds => !!snap.SnapshotId && !!snap.VolumeId,
          );
          skipped += page.length - validSnapshots.length;
          return validSnapshots
            .map(
              (snap) =>
                new EbsSnapshot({
                  snapshotId: snap.SnapshotId,
                  region,
                  accountId: this.accountId,
                  sourceVolumeId: snap.VolumeId,
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
        },
      );

      if (skipped > 0) {
        logger.debug(
          `${this.kind}: skipped ${skipped} entries missing SnapshotId/VolumeId`,
        );
      }

      return Result.ok(orphans);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
