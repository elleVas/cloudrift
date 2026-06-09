import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  type Reservation,
  type Volume,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type {
  Ec2InstanceRepositoryPort,
  AwsRegion,
  Ec2InstanceState,
  AttachedVolume,
  PricingPort,
} from 'cloud-cost-domain';
import { Ec2Instance } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsEc2InstanceRepositoryAdapter implements Ec2InstanceRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId: string = 'unknown',
  ) {}

  async findStoppedInstances(
    region: AwsRegion,
  ): ReturnType<Ec2InstanceRepositoryPort['findStoppedInstances']> {
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

      const volumeIds = rawInstances.flatMap((inst) =>
        (inst.BlockDeviceMappings ?? [])
          .map((bdm) => bdm.Ebs?.VolumeId)
          .filter((id): id is string => !!id),
      );

      const volumeMap = new Map<string, { sizeGb: number; volumeType: string }>();

      if (volumeIds.length > 0) {
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
      }

      const instances = rawInstances.map((inst) => {
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
          detectedAt: new Date(),
          attachedVolumes,
          tags: Object.fromEntries(
            (inst.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
          ),
          monthlyCostUsd,
        });
      });

      return Result.ok(instances);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
