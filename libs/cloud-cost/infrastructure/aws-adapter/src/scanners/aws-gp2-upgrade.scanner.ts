import {
  EC2Client,
  DescribeVolumesCommand,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { Gp2Volume, Gp2UpgradePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

/**
 * Rileva i volumi gp2 *attaccati e in uso* aggiornabili a gp3: stesso baseline
 * di performance, costo inferiore. Non è spreco da cancellare, è un risparmio.
 *
 * Prefiltro server-side: `volume-type=gp2` AND `status=in-use`. I gp2 *non*
 * attaccati (available) sono già gestiti dal flusso `ebs-volume`, quindi non
 * c'è doppio conteggio.
 */
export class AwsGp2UpgradeScanner implements WasteScannerPort {
  readonly kind = 'ebs-gp2-upgrade' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new Gp2UpgradePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ region: region.code });
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

      const gp2PricePerGb = this.pricing.getEbsVolumePricePerGbMonth(region, 'gp2');
      const gp3PricePerGb = this.pricing.getEbsVolumePricePerGbMonth(region, 'gp3');
      const savingPerGb = Math.max(0, gp2PricePerGb - gp3PricePerGb);
      const now = new Date();

      const volumes = rawVolumes
        .map((v: Volume) => {
          const sizeGb = v.Size ?? 0;
          return new Gp2Volume({
            volumeId: v.VolumeId!,
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
