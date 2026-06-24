// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  type Instance,
  type Reservation,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type {
  AttachedVolume,
  AwsRegion,
  Ec2InstanceState,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { Ec2Instance, Ec2InstanceWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

// AWS only reports the stop time inside StateTransitionReason,
// as a string like "User initiated (2026-06-01 12:34:56 GMT)".
function parseStoppedSince(stateTransitionReason: string | undefined): Date | undefined {
  const match = stateTransitionReason?.match(/\((.+) GMT\)/);
  if (!match) return undefined;
  const parsed = new Date(`${match[1]} UTC`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export class AwsEc2InstanceScanner implements WasteScannerPort {
  readonly kind = 'ec2-instance' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2InstanceWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ region: region.code });
    try {
      const reservations = await paginate<Reservation>(async (cursor) => {
        const r = await client.send(
          new DescribeInstancesCommand({
            Filters: [{ Name: 'instance-state-name', Values: ['stopped'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.Reservations ?? [], cursor: r.NextToken };
      });

      const rawInstances = reservations.flatMap((r) => r.Instances ?? []);

      if (rawInstances.length === 0) {
        return Result.ok([]);
      }

      const volumeMap = await this.resolveVolumes(client, rawInstances);

      const now = new Date();
      const instances = rawInstances
        .map((inst) => {
          const attachedVolumes: AttachedVolume[] = (inst.BlockDeviceMappings ?? [])
            .map((bdm) => bdm.Ebs?.VolumeId)
            .filter((id): id is string => !!id)
            .map((volId) => ({
              volumeId: volId,
              sizeGb: volumeMap.get(volId)?.sizeGb ?? 0,
              volumeType: volumeMap.get(volId)?.volumeType ?? 'gp2',
            }));

          const monthlyCostUsd = +attachedVolumes.reduce((sum, vol) => {
            const pricePerGb = this.pricing.getEbsVolumePricePerGbMonth(region, vol.volumeType);
            return sum + pricePerGb * vol.sizeGb;
          }, 0).toFixed(4);

          return new Ec2Instance({
            instanceId: inst.InstanceId!,
            region,
            accountId: this.accountId,
            instanceType: inst.InstanceType ?? 'unknown',
            state: (inst.State?.Name ?? 'stopped') as Ec2InstanceState,
            launchTime: inst.LaunchTime ?? new Date(0),
            detectedAt: now,
            stoppedSince: parseStoppedSince(inst.StateTransitionReason),
            attachedVolumes,
            tags: Object.fromEntries(
              (inst.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd,
          });
        })
        .filter((instance) => this.policy.evaluate(instance, now).isWaste);

      return Result.ok(instances);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }

  // DescribeInstances doesn't report volume size/type: a second call is needed.
  private async resolveVolumes(
    client: EC2Client,
    rawInstances: Instance[],
  ): Promise<Map<string, { sizeGb: number; volumeType: string }>> {
    const volumeIds = rawInstances.flatMap((inst) =>
      (inst.BlockDeviceMappings ?? [])
        .map((bdm) => bdm.Ebs?.VolumeId)
        .filter((id): id is string => !!id),
    );

    const volumeMap = new Map<string, { sizeGb: number; volumeType: string }>();
    if (volumeIds.length === 0) return volumeMap;

    const allVolumes = await paginate<Volume>(async (cursor) => {
      const r = await client.send(
        new DescribeVolumesCommand({ VolumeIds: volumeIds, NextToken: cursor }),
      );
      return { items: r.Volumes ?? [], cursor: r.NextToken };
    });

    for (const vol of allVolumes) {
      if (vol.VolumeId) {
        volumeMap.set(vol.VolumeId, {
          sizeGb: vol.Size ?? 0,
          volumeType: vol.VolumeType ?? 'gp2',
        });
      }
    }
    return volumeMap;
  }
}
