// SPDX-License-Identifier: Apache-2.0
import { FsxFileSystem } from './fsx-file-system.entity';
import type { FsxFileSystemProps } from './fsx-file-system.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeFileSystem(overrides: Partial<FsxFileSystemProps> = {}): FsxFileSystem {
  return new FsxFileSystem({
    fileSystemId: 'fs-0123456789abcdef0',
    region,
    accountId: '123456789012',
    fileSystemType: 'WINDOWS',
    storageCapacityGiB: 300,
    ioBytesLastWindow: 0,
    metricWindowHours: 48,
    creationTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 94.2,
    ...overrides,
  });
}

describe('FsxFileSystem', () => {
  it('exposes correct id and fields', () => {
    const fileSystem = makeFileSystem();
    expect(fileSystem.id).toBe('fs-0123456789abcdef0');
    expect(fileSystem.fileSystemType).toBe('WINDOWS');
  });

  it('exposes kind', () => {
    expect(makeFileSystem().kind).toBe('fsx-idle-filesystem');
  });

  it('wasteReason references the metric window', () => {
    expect(makeFileSystem({ metricWindowHours: 48 }).wasteReason).toBe('zero I/O in last 48h');
  });

  it('isIdle returns true when no I/O was observed', () => {
    expect(makeFileSystem({ ioBytesLastWindow: 0 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when I/O was observed', () => {
    expect(makeFileSystem({ ioBytesLastWindow: 4096 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeFileSystem().costEstimate.monthlyCostUsd).toBe(94.2);
  });

  it('costEstimate description references the file system type', () => {
    expect(makeFileSystem({ fileSystemType: 'LUSTRE' }).costEstimate.description).toContain('LUSTRE');
  });

  it('exposes the remaining props', () => {
    const creationTime = new Date('2024-01-01');
    const detectedAt = new Date('2026-06-09');
    const fileSystem = makeFileSystem({
      region,
      accountId: '999999999999',
      storageCapacityGiB: 1200,
      creationTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(fileSystem.region).toBe(region);
    expect(fileSystem.accountId).toBe('999999999999');
    expect(fileSystem.storageCapacityGiB).toBe(1200);
    expect(fileSystem.creationTime).toBe(creationTime);
    expect(fileSystem.detectedAt).toBe(detectedAt);
    expect(fileSystem.tags).toEqual({ env: 'prod' });
  });
});
