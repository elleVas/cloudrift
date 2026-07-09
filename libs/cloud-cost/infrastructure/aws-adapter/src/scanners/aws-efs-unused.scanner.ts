// SPDX-License-Identifier: Apache-2.0
import { EFSClient, DescribeFileSystemsCommand, type FileSystemDescription } from '@aws-sdk/client-efs';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { EfsFileSystem, EfsUnusedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const logger = createLogger('cloudrift:scanner');

type FileSystemWithId = FileSystemDescription & { FileSystemId: string };

/**
 * Detects EFS file systems with no mount targets (unusable) or with mount
 * targets but zero I/O in the observed window (mounted but inactive).
 * `DescribeFileSystems` already exposes `NumberOfMountTargets` and
 * `SizeInBytes`: no need for `DescribeMountTargets`.
 */
export class AwsEfsUnusedScanner extends CloudWatchIdleScanner<
  EFSClient,
  FileSystemWithId,
  number,
  EfsFileSystem
> {
  readonly kind = 'efs-unused' as const;
  protected readonly serviceLabel = 'EFS';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<EfsFileSystem> = new EfsUnusedPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EFSClient {
    return new EFSClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: EFSClient): void {
    client.destroy();
  }

  protected async listResources(client: EFSClient): Promise<FileSystemWithId[]> {
    const fileSystems = await paginate<FileSystemDescription>(async (cursor) => {
      const r = await client.send(new DescribeFileSystemsCommand({ Marker: cursor }));
      return { items: r.FileSystems ?? [], cursor: r.Marker };
    });
    const valid = fileSystems.filter((fs): fs is FileSystemWithId => !!fs.FileSystemId);
    if (valid.length !== fileSystems.length) {
      logger.debug(`${this.kind}: skipped ${fileSystems.length - valid.length} entries missing FileSystemId`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, fs: FileSystemWithId, window: MetricWindow) {
    return (fs.NumberOfMountTargets ?? 0) === 0
      ? Promise.resolve(0)
      : sumMetrics(
          cw,
          'AWS/EFS',
          ['DataReadIOBytes', 'DataWriteIOBytes'],
          [{ Name: 'FileSystemId', Value: fs.FileSystemId }],
          window,
        );
  }

  protected toEntity(
    fs: FileSystemWithId,
    ioBytesLastWindow: number,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): EfsFileSystem {
    const sizeBytes = fs.SizeInBytes?.Value ?? 0;
    const sizeGb = sizeBytes / 1024 ** 3;
    const pricePerGb = this.pricing.getPrice(region, 'efs-standard');
    return new EfsFileSystem({
      fileSystemId: fs.FileSystemId,
      region,
      accountId: this.accountId,
      sizeBytes,
      numberOfMountTargets: fs.NumberOfMountTargets ?? 0,
      ioBytesLastWindow,
      metricWindowHours: this.windowHours,
      creationTime: fs.CreationTime ?? new Date(0),
      detectedAt: now,
      tags: Object.fromEntries((fs.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +(sizeGb * pricePerGb).toFixed(4),
    });
  }
}
