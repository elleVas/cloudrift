import {
  EFSClient,
  DescribeFileSystemsCommand,
  type FileSystemDescription,
} from '@aws-sdk/client-efs';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { EfsFileSystem, EfsUnusedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Rileva file system EFS senza mount target (inutilizzabili) o con mount
 * target ma zero I/O nella finestra osservata (montati ma inattivi).
 * `DescribeFileSystems` espone già `NumberOfMountTargets` e `SizeInBytes`:
 * non serve `DescribeMountTargets`.
 */
export class AwsEfsUnusedScanner implements WasteScannerPort {
  readonly kind = 'efs-unused' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EfsUnusedPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const efs = new EFSClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const rawFileSystems = await paginate<FileSystemDescription>(async (cursor) => {
        const r = await efs.send(new DescribeFileSystemsCommand({ Marker: cursor }));
        return { items: r.FileSystems ?? [], cursor: r.Marker };
      });

      if (rawFileSystems.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const ioBytes = await mapWithConcurrency(rawFileSystems, CLOUDWATCH_CONCURRENCY, (fs) =>
        (fs.NumberOfMountTargets ?? 0) === 0
          ? Promise.resolve(0)
          : this.sumIoBytes(cw, fs.FileSystemId!, startTime, endTime, periodSeconds),
      );

      const pricePerGb = this.pricing.getEfsStandardPricePerGbMonth(region);
      const now = new Date();

      const fileSystems = rawFileSystems
        .map((fs, index) => {
          const sizeBytes = fs.SizeInBytes?.Value ?? 0;
          const sizeGb = sizeBytes / 1024 ** 3;
          return new EfsFileSystem({
            fileSystemId: fs.FileSystemId!,
            region,
            accountId: this.accountId,
            sizeBytes,
            numberOfMountTargets: fs.NumberOfMountTargets ?? 0,
            ioBytesLastWindow: ioBytes[index],
            metricWindowHours: this.windowHours,
            creationTime: fs.CreationTime ?? new Date(0),
            detectedAt: now,
            tags: Object.fromEntries((fs.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            monthlyCostUsd: +(sizeGb * pricePerGb).toFixed(4),
          });
        })
        .filter((fs) => this.policy.evaluate(fs, now).isWaste);

      return Result.ok(fileSystems);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EFS', err as Error));
    } finally {
      efs.destroy();
      cw.destroy();
    }
  }

  private async sumIoBytes(
    cw: CloudWatchClient,
    fileSystemId: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const [read, write] = await Promise.all([
      this.sumMetric(cw, fileSystemId, 'DataReadIOBytes', startTime, endTime, periodSeconds),
      this.sumMetric(cw, fileSystemId, 'DataWriteIOBytes', startTime, endTime, periodSeconds),
    ]);
    return read + write;
  }

  private async sumMetric(
    cw: CloudWatchClient,
    fileSystemId: string,
    metricName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/EFS',
        MetricName: metricName,
        Dimensions: [{ Name: 'FileSystemId', Value: fileSystemId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
