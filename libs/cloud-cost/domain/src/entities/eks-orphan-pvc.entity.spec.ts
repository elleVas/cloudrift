// SPDX-License-Identifier: Apache-2.0
import { EksOrphanPvc } from './eks-orphan-pvc.entity';
import type { EksOrphanPvcProps } from './eks-orphan-pvc.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeVolume(overrides: Partial<EksOrphanPvcProps> = {}): EksOrphanPvc {
  return new EksOrphanPvc({
    volumeId: 'vol-0123456789abcdef0',
    region,
    accountId: '123456789012',
    pvcName: 'data-pvc',
    pvcNamespace: 'default',
    clusterName: undefined,
    clusterExists: true,
    sizeGb: 20,
    volumeType: 'gp3',
    state: 'available',
    createdTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 1.6,
    ...overrides,
  });
}

describe('EksOrphanPvc', () => {
  it('exposes correct id and fields', () => {
    const volume = makeVolume();
    expect(volume.id).toBe('vol-0123456789abcdef0');
    expect(volume.pvcName).toBe('data-pvc');
    expect(volume.pvcNamespace).toBe('default');
  });

  it('exposes kind', () => {
    expect(makeVolume().kind).toBe('eks-orphan-pvc');
  });

  it('isUnattached is true when state is available', () => {
    expect(makeVolume({ state: 'available' }).isUnattached()).toBe(true);
  });

  it('isUnattached is false when state is in-use', () => {
    expect(makeVolume({ state: 'in-use' }).isUnattached()).toBe(false);
  });

  it('isOrphanedByMissingCluster is false when clusterName is absent', () => {
    const volume = makeVolume({ clusterName: undefined, clusterExists: true });
    expect(volume.isOrphanedByMissingCluster).toBe(false);
  });

  it('isOrphanedByMissingCluster is false when clusterName is present and the cluster still exists', () => {
    const volume = makeVolume({ clusterName: 'my-cluster', clusterExists: true });
    expect(volume.isOrphanedByMissingCluster).toBe(false);
  });

  it('isOrphanedByMissingCluster is true when clusterName is present and the cluster no longer exists', () => {
    const volume = makeVolume({ clusterName: 'my-cluster', clusterExists: false });
    expect(volume.isOrphanedByMissingCluster).toBe(true);
  });

  it('wasteReason reports the unattached PVC when there is no evidence of a missing cluster', () => {
    const volume = makeVolume({ clusterName: undefined, clusterExists: true });
    expect(volume.wasteReason).toBe('unattached (Kubernetes PVC volume, no Pod using it)');
  });

  it('wasteReason references the missing cluster when it no longer exists', () => {
    const volume = makeVolume({ clusterName: 'my-cluster', clusterExists: false });
    expect(volume.wasteReason).toBe('owning EKS cluster "my-cluster" no longer exists');
  });

  it('costEstimate returns the fixed monthly cost and describes the volume', () => {
    const volume = makeVolume({ sizeGb: 20, volumeType: 'gp3', pvcNamespace: 'default', pvcName: 'data-pvc' });
    expect(volume.costEstimate.monthlyCostUsd).toBe(1.6);
    expect(volume.costEstimate.description).toBe('20 GB gp3 orphaned Kubernetes PVC volume (default/data-pvc)');
  });

  it('exposes the remaining props', () => {
    const createdTime = new Date('2025-09-01');
    const detectedAt = new Date('2026-06-09');
    const volume = makeVolume({
      region,
      accountId: '999999999999',
      clusterName: 'other-cluster',
      clusterExists: true,
      sizeGb: 100,
      volumeType: 'io1',
      state: 'in-use',
      createdTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(volume.region).toBe(region);
    expect(volume.accountId).toBe('999999999999');
    expect(volume.clusterName).toBe('other-cluster');
    expect(volume.clusterExists).toBe(true);
    expect(volume.sizeGb).toBe(100);
    expect(volume.volumeType).toBe('io1');
    expect(volume.state).toBe('in-use');
    expect(volume.createdTime).toBe(createdTime);
    expect(volume.detectedAt).toBe(detectedAt);
    expect(volume.tags).toEqual({ env: 'prod' });
  });
});
