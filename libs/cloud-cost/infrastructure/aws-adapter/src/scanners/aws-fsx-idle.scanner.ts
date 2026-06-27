// SPDX-License-Identifier: Apache-2.0
import { FSxClient, DescribeFileSystemsCommand, type FileSystem } from '@aws-sdk/client-fsx';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { FsxFileSystem, FsxIdleFilesystemPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Detects FSx file systems with zero read/write I/O in the observed window.
 * Storage type cardinality is low (WINDOWS/LUSTRE/ONTAP/OPENZFS), so the
 * price comes from the static list/PRICE_SPECS, not `--live-pricing`
 * (ADR-0037).
 */
export class AwsFsxIdleScanner implements WasteScannerPort {
  readonly kind = 'fsx-idle-filesystem' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new FsxIdleFilesystemPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const fsx = new FSxClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const fileSystems = await paginate<FileSystem>(async (cursor) => {
        const r = await fsx.send(new DescribeFileSystemsCommand({ NextToken: cursor }));
        return { items: r.FileSystems ?? [], cursor: r.NextToken };
      });

      if (fileSystems.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const ioBytes = await mapWithConcurrency(fileSystems, CLOUDWATCH_CONCURRENCY, (fs) =>
        this.sumIoBytes(cw, fs.FileSystemId!, startTime, endTime, periodSeconds),
      );

      const now = new Date();
      const idle = fileSystems
        .map((fs, index) => {
          const fileSystemType = fs.FileSystemType ?? 'WINDOWS';
          const storageCapacityGiB = fs.StorageCapacity ?? 0;
          const monthlyCostUsd = this.pricing.getFsxStoragePricePerGbMonth(region, fileSystemType) * storageCapacityGiB;
          return new FsxFileSystem({
            fileSystemId: fs.FileSystemId!,
            region,
            accountId: this.accountId,
            fileSystemType,
            storageCapacityGiB,
            ioBytesLastWindow: ioBytes[index],
            metricWindowHours: this.windowHours,
            creationTime: fs.CreationTime ?? new Date(0),
            detectedAt: now,
            tags: Object.fromEntries((fs.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            monthlyCostUsd: +monthlyCostUsd.toFixed(4),
          });
        })
        .filter((fs) => this.policy.evaluate(fs, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('FSx', err as Error));
    } finally {
      fsx.destroy();
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
    const [read, write] = await Promise.all(
      ['DataReadBytes', 'DataWriteBytes'].map((metricName) =>
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/FSx',
            MetricName: metricName,
            Dimensions: [{ Name: 'FileSystemId', Value: fileSystemId }],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: ['Sum'],
          }),
        ),
      ),
    );
    return (read.Datapoints?.[0]?.Sum ?? 0) + (write.Datapoints?.[0]?.Sum ?? 0);
  }
}
