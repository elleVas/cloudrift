// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeLaunchTemplatesCommand,
  DescribeLaunchTemplateVersionsCommand,
  type Image,
  type Instance,
  type LaunchTemplate,
  type Reservation,
} from '@aws-sdk/client-ec2';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { AmiUnused, AmiUnusedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type ImageWithId = Image & { ImageId: string };

/**
 * Detects self-owned AMIs not referenced by any instance (running or
 * stopped) or by a launch template's latest version. Does not check Auto
 * Scaling launch configurations (legacy, superseded by launch templates) —
 * an ASG still on a launch config referencing this AMI would be a false
 * positive, same documented trade-off class as environment-ghost's allowlist.
 */
export class AwsAmiUnusedScanner implements WasteScannerPort {
  readonly kind = 'ami-unused' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new AmiUnusedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const [images, instances, templates] = await Promise.all([
        paginate<Image>(async (cursor) => {
          const r = await client.send(
            new DescribeImagesCommand({ Owners: ['self'], NextToken: cursor }),
          );
          return { items: r.Images ?? [], cursor: r.NextToken };
        }),
        paginate<Reservation, Instance>(
          async (cursor) => {
            const r = await client.send(new DescribeInstancesCommand({ NextToken: cursor }));
            return { items: r.Reservations ?? [], cursor: r.NextToken };
          },
          (reservations) => reservations.flatMap((r) => r.Instances ?? []),
        ),
        paginate<LaunchTemplate>(async (cursor) => {
          const r = await client.send(new DescribeLaunchTemplatesCommand({ NextToken: cursor }));
          return { items: r.LaunchTemplates ?? [], cursor: r.NextToken };
        }),
      ]);

      const activeImageIds = new Set<string>();
      for (const instance of instances) {
        if (instance.State?.Name !== 'terminated' && instance.ImageId) {
          activeImageIds.add(instance.ImageId);
        }
      }

      const templateVersionPages = await Promise.all(
        templates
          .filter((t) => t.LaunchTemplateId)
          .map((t) =>
            client.send(
              new DescribeLaunchTemplateVersionsCommand({
                LaunchTemplateId: t.LaunchTemplateId,
                Versions: ['$Latest'],
              }),
            ),
          ),
      );
      for (const page of templateVersionPages) {
        for (const version of page.LaunchTemplateVersions ?? []) {
          const imageId = version.LaunchTemplateData?.ImageId;
          if (imageId) activeImageIds.add(imageId);
        }
      }

      const now = new Date();
      const pricePerGb = this.pricing.getPrice(region, 'ebs-snapshot');
      const validImages = images.filter((img): img is ImageWithId => !!img.ImageId);
      if (validImages.length !== images.length) {
        logger.debug(`${this.kind}: skipped ${images.length - validImages.length} entries missing ImageId`);
      }

      const results = validImages
        .map((img) => {
          const totalSnapshotSizeGb = (img.BlockDeviceMappings ?? []).reduce(
            (sum, bdm) => sum + (bdm.Ebs?.VolumeSize ?? 0),
            0,
          );
          return new AmiUnused({
            imageId: img.ImageId,
            region,
            accountId: this.accountId,
            name: img.Name ?? '',
            creationDate: img.CreationDate ? new Date(img.CreationDate) : new Date(0),
            detectedAt: now,
            inUse: activeImageIds.has(img.ImageId),
            totalSnapshotSizeGb,
            tags: Object.fromEntries((img.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            monthlyCostUsd: +(totalSnapshotSizeGb * pricePerGb).toFixed(4),
          });
        })
        .filter((ami) => this.policy.evaluate(ami, now).isWaste);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
