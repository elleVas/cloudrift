// SPDX-License-Identifier: Apache-2.0
import { FSxClient, DescribeFileSystemsCommand, type FileSystem } from '@aws-sdk/client-fsx';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { FsxFileSystem, FsxIdleFilesystemPolicy, type WastePolicy } from 'cloud-cost-domain';
import { createAwsClientConfig } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const logger = createLogger('cloudrift:scanner');

type FileSystemWithId = FileSystem & { FileSystemId: string };

/**
 * Detects FSx file systems with zero read/write I/O in the observed window.
 * Storage type cardinality is low (WINDOWS/LUSTRE/ONTAP/OPENZFS), so the
 * price comes from the static list/PRICE_SPECS, not `--live-pricing`
 * (ADR-0037).
 */
export class AwsFsxIdleScanner extends CloudWatchIdleScanner<FSxClient, FileSystemWithId, number, FsxFileSystem> {
  readonly kind = 'fsx-idle-filesystem' as const;
  protected readonly serviceLabel = 'FSx';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<FsxFileSystem> = new FsxIdleFilesystemPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): FSxClient {
    return new FSxClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: FSxClient): void {
    client.destroy();
  }

  protected async listResources(client: FSxClient): Promise<FileSystemWithId[]> {
    const fileSystems = await paginate<FileSystem>(async (cursor) => {
      const r = await client.send(new DescribeFileSystemsCommand({ NextToken: cursor }));
      return { items: r.FileSystems ?? [], cursor: r.NextToken };
    });
    const valid = fileSystems.filter((fs): fs is FileSystemWithId => !!fs.FileSystemId);
    if (valid.length !== fileSystems.length) {
      logger.debug(`${this.kind}: skipped ${fileSystems.length - valid.length} entries missing FileSystemId`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, fs: FileSystemWithId, window: MetricWindow) {
    return sumMetrics(
      cw,
      'AWS/FSx',
      ['DataReadBytes', 'DataWriteBytes'],
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
  ): FsxFileSystem {
    const fileSystemType = fs.FileSystemType ?? 'WINDOWS';
    const storageCapacityGiB = fs.StorageCapacity ?? 0;
    const fsxPricePerGb =
      this.pricing.getPrice(region, `fsx-${fileSystemType.toLowerCase()}`) ||
      this.pricing.getPrice(region, 'fsx-windows');
    const monthlyCostUsd = fsxPricePerGb * storageCapacityGiB;
    return new FsxFileSystem({
      fileSystemId: fs.FileSystemId,
      region,
      accountId: this.accountId,
      fileSystemType,
      storageCapacityGiB,
      ioBytesLastWindow,
      metricWindowHours: this.windowHours,
      creationTime: fs.CreationTime ?? new Date(0),
      detectedAt: now,
      tags: Object.fromEntries((fs.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +monthlyCostUsd.toFixed(4),
    });
  }
}
