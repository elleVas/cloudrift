// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeVolumesCommand,
  type Volume,
} from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  EbsVolumeState,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { EbsVolume, EbsVolumeWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

type VolumeWithIdAndSize = Volume & { VolumeId: string; Size: number };

export class AwsEbsVolumeScanner implements WasteScannerPort {
  readonly kind = 'ebs-volume' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new EbsVolumeWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(this.credentials), region: region.code });
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
      const validVolumes = rawVolumes.filter(
        (v): v is VolumeWithIdAndSize => !!v.VolumeId && v.Size !== undefined,
      );
      if (validVolumes.length !== rawVolumes.length) {
        logger.debug(`${this.kind}: skipped ${rawVolumes.length - validVolumes.length} entries missing VolumeId/Size`);
      }

      const volumes = validVolumes
        .map((v) => {
          const volumeType = v.VolumeType ?? 'gp2';
          const pricePerGb =
            this.pricing.getPrice(region, `ebs-${volumeType}`) || this.pricing.getPrice(region, 'ebs-gp3');
          const props = {
            volumeId: v.VolumeId,
            region,
            accountId: this.accountId,
            sizeGb: v.Size,
            volumeType,
            // Cast, not narrowed: the SDK's `VolumeState` union is exactly
            // `EbsVolumeState`'s member set, but the field is optional in the
            // SDK type (defensive codegen — AWS always returns it for a real
            // volume). There's no fallback here unlike `aws-ec2-instance`'s
            // `?? 'stopped'`/`aws-rds-instance`'s `?? 'stopped'`, because no
            // `EbsVolumeState` value is a safe stand-in for "AWS omitted the
            // state of a volume that unambiguously exists" — picking one
            // needs a product decision (deferred: see cast-cleanup ADR).
            state: v.State as EbsVolumeState,
            createTime: v.CreateTime ?? new Date(),
            detectedAt: now,
            tags: Object.fromEntries(
              (v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(pricePerGb * v.Size).toFixed(4),
          };
          // Evaluated twice by design: the policy needs a constructed entity to
          // call isUnattached()/createTime, but its verdict.reason must flow
          // into the final (immutable) entity rather than being discarded.
          const verdict = this.policy.evaluate(new EbsVolume({ ...props, wasteReason: '' }), now);
          return verdict.isWaste ? new EbsVolume({ ...props, wasteReason: verdict.reason }) : null;
        })
        .filter((volume): volume is EbsVolume => volume !== null);

      return Result.ok(volumes);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EBS', err));
    } finally {
      client.destroy();
    }
  }
}
