import { EfsFileSystem } from './efs-file-system.entity';
import type { EfsFileSystemProps } from './efs-file-system.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeFileSystem(overrides: Partial<EfsFileSystemProps> = {}): EfsFileSystem {
  return new EfsFileSystem({
    fileSystemId: 'fs-0abc123',
    region,
    accountId: '123456789012',
    sizeBytes: 1024 ** 3,
    numberOfMountTargets: 0,
    ioBytesLastWindow: 0,
    metricWindowHours: 48,
    creationTime: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 0.3,
    ...overrides,
  });
}

describe('EfsFileSystem', () => {
  it('exposes correct id and fields', () => {
    const fs = makeFileSystem();
    expect(fs.id).toBe('fs-0abc123');
    expect(fs.sizeBytes).toBe(1024 ** 3);
    expect(fs.tags).toEqual({ Env: 'dev' });
  });

  it('hasNoMountTargets returns true when numberOfMountTargets is 0', () => {
    expect(makeFileSystem({ numberOfMountTargets: 0 }).hasNoMountTargets()).toBe(true);
  });

  it('hasNoMountTargets returns false when mounted', () => {
    expect(makeFileSystem({ numberOfMountTargets: 2 }).hasNoMountTargets()).toBe(false);
  });

  it('exposes kind and wasteReason for an orphan file system', () => {
    expect(makeFileSystem().kind).toBe('efs-unused');
    expect(makeFileSystem({ numberOfMountTargets: 0 }).wasteReason).toBe('no mount targets');
  });

  it('wasteReason references the observation window when mounted but idle', () => {
    expect(makeFileSystem({ numberOfMountTargets: 1 }).wasteReason).toContain('48h');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeFileSystem().costEstimate.monthlyCostUsd).toBe(0.3);
  });

  it('costEstimate description references the file system size', () => {
    expect(makeFileSystem().costEstimate.description).toContain('GB');
  });
});
