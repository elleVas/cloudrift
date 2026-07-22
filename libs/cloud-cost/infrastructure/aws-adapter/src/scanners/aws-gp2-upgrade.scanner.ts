// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeVolumesCommand,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { Gp2Volume, EbsGp2UpgradePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type VolumeWithId = Volume & { VolumeId: string };

/**
 * Detects gp2 volumes that are *attached and in use* and upgradable to gp3:
 * same performance baseline, lower cost. It's not waste to delete, it's a
 * saving.
 *
 * Server-side prefilter: `volume-type=gp2` AND `status=in-use`. gp2 volumes
 * that are *not* attached (available) are already handled by the
 * `ebs-volume` flow, so there's no double counting.
 */
export class AwsGp2UpgradeScanner implements WasteScannerPort {
  readonly kind = 'ebs-gp2-upgrade' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EbsGp2UpgradePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawVolumes = await paginate<Volume>(async (cursor) => {
        const r = await client.send(
          new DescribeVolumesCommand({
            Filters: [
              { Name: 'volume-type', Values: ['gp2'] },
              { Name: 'status', Values: ['in-use'] },
            ],
            NextToken: cursor,
          }),
        );
        return { items: r.Volumes ?? [], cursor: r.NextToken };
      });

      const gp2PricePerGb = this.pricing.getPrice(region, 'ebs-gp2');
      const gp3PricePerGb = this.pricing.getPrice(region, 'ebs-gp3');
      const savingPerGb = Math.max(0, gp2PricePerGb - gp3PricePerGb);
      const now = new Date();

      const validVolumes = rawVolumes.filter((v): v is VolumeWithId => !!v.VolumeId);
      if (validVolumes.length !== rawVolumes.length) {
        logger.debug(`${this.kind}: skipped ${rawVolumes.length - validVolumes.length} entries missing VolumeId`);
      }

      const volumes = validVolumes
        .map((v) => {
          const sizeGb = v.Size ?? 0;
          return new Gp2Volume({
            volumeId: v.VolumeId,
            region,
            accountId: this.accountId,
            sizeGb,
            createTime: v.CreateTime ?? new Date(),
            detectedAt: now,
            tags: Object.fromEntries(
              (v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(savingPerGb * sizeGb).toFixed(4),
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
