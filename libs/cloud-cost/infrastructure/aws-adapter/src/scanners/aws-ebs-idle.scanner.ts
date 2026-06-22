import {
  EC2Client,
  DescribeVolumesCommand,
  type Volume,
} from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { IdleEbsVolume, EbsIdlePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Detects EBS volumes that are *attached* (in-use) but with no I/O in the
 * observed window: storage paid for an idle disk. Distinct from
 * `ebs-volume` (unattached volumes). For each volume it sums
 * `VolumeReadOps` + `VolumeWriteOps` from CloudWatch; the threshold/decision
 * belongs to the policy.
 */
export class AwsEbsIdleScanner implements WasteScannerPort {
  readonly kind = 'ebs-idle' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EbsIdlePolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const ec2 = new EC2Client({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const rawVolumes = await paginate<Volume>(async (cursor) => {
        const r = await ec2.send(
          new DescribeVolumesCommand({
            Filters: [{ Name: 'status', Values: ['in-use'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.Volumes ?? [], cursor: r.NextToken };
      });

      if (rawVolumes.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;
      const now = new Date();

      const ops = await mapWithConcurrency(rawVolumes, CLOUDWATCH_CONCURRENCY, async (v) => {
        const [readOps, writeOps] = await Promise.all([
          this.sumMetric(cw, v.VolumeId!, 'VolumeReadOps', startTime, endTime, periodSeconds),
          this.sumMetric(cw, v.VolumeId!, 'VolumeWriteOps', startTime, endTime, periodSeconds),
        ]);
        return { readOps, writeOps };
      });

      const volumes = rawVolumes
        .map((v: Volume, index) => {
          const volumeType = v.VolumeType ?? 'gp2';
          const sizeGb = v.Size ?? 0;
          const pricePerGb = this.pricing.getEbsVolumePricePerGbMonth(region, volumeType);
          return new IdleEbsVolume({
            volumeId: v.VolumeId!,
            region,
            accountId: this.accountId,
            sizeGb,
            volumeType,
            attachedInstanceId: v.Attachments?.[0]?.InstanceId,
            readOps: ops[index].readOps,
            writeOps: ops[index].writeOps,
            metricWindowHours: this.windowHours,
            createTime: v.CreateTime ?? new Date(),
            detectedAt: now,
            tags: Object.fromEntries(
              (v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(pricePerGb * sizeGb).toFixed(4),
          });
        })
        .filter((volume) => this.policy.evaluate(volume, now).isWaste);

      return Result.ok(volumes);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EBS', err as Error));
    } finally {
      ec2.destroy();
      cw.destroy();
    }
  }

  private async sumMetric(
    cw: CloudWatchClient,
    volumeId: string,
    metricName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/EBS',
        MetricName: metricName,
        Dimensions: [{ Name: 'VolumeId', Value: volumeId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
