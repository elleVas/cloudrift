// SPDX-License-Identifier: Apache-2.0
import { EksNodeOverprovisioned } from './eks-node-overprovisioned.entity';
import type { EksNodeOverprovisionedProps } from './eks-node-overprovisioned.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeNodegroup(overrides: Partial<EksNodeOverprovisionedProps> = {}): EksNodeOverprovisioned {
  return new EksNodeOverprovisioned({
    clusterName: 'my-cluster',
    nodegroupName: 'ng-1',
    region,
    accountId: '123456789012',
    instanceType: 'm5.large',
    nodeCount: 4,
    suggestedNodeCount: 2,
    cpuAllocatableMillis: 8000,
    cpuRequestedMillis: 2000,
    memoryAllocatableBytes: 32_000_000_000,
    memoryRequestedBytes: 8_000_000_000,
    hasDatapoint: true,
    windowHours: 168,
    nodegroupCreateTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 120,
    ...overrides,
  });
}

describe('EksNodeOverprovisioned', () => {
  it('exposes correct id and fields', () => {
    const nodegroup = makeNodegroup();
    expect(nodegroup.id).toBe('my-cluster/ng-1');
    expect(nodegroup.clusterName).toBe('my-cluster');
    expect(nodegroup.nodegroupName).toBe('ng-1');
  });

  it('exposes kind', () => {
    expect(makeNodegroup().kind).toBe('eks-node-overprovisioned');
  });

  it('cpuRequestedPercent divides requested by allocatable when allocatable is positive', () => {
    const nodegroup = makeNodegroup({ cpuAllocatableMillis: 8000, cpuRequestedMillis: 2000 });
    expect(nodegroup.cpuRequestedPercent).toBe(25);
  });

  it('cpuRequestedPercent is 0 when allocatable is 0', () => {
    const nodegroup = makeNodegroup({ cpuAllocatableMillis: 0, cpuRequestedMillis: 0 });
    expect(nodegroup.cpuRequestedPercent).toBe(0);
  });

  it('wasteReason reports the requested percentage, node count and window', () => {
    const nodegroup = makeNodegroup({
      cpuAllocatableMillis: 8000,
      cpuRequestedMillis: 2000,
      nodeCount: 4,
      windowHours: 168,
    });
    expect(nodegroup.wasteReason).toContain('CPU requested 25.0% of allocatable across 4 node(s) over 168h');
  });

  it('costEstimate returns the estimated saving with the scale-down description', () => {
    const nodegroup = makeNodegroup({
      clusterName: 'my-cluster',
      nodegroupName: 'ng-1',
      instanceType: 'm5.large',
      nodeCount: 4,
      suggestedNodeCount: 2,
      monthlyCostUsd: 120,
    });
    expect(nodegroup.costEstimate.monthlyCostUsd).toBe(120);
    expect(nodegroup.costEstimate.description).toBe('EKS node group my-cluster/ng-1 m5.large 4→2 nodes — estimated saving');
  });

  it('exposes the remaining props', () => {
    const nodegroupCreateTime = new Date('2025-11-01');
    const detectedAt = new Date('2026-06-09');
    const nodegroup = makeNodegroup({
      region,
      accountId: '999999999999',
      instanceType: 'c5.xlarge',
      nodeCount: 6,
      suggestedNodeCount: 3,
      cpuAllocatableMillis: 12000,
      cpuRequestedMillis: 3000,
      memoryAllocatableBytes: 64_000_000_000,
      memoryRequestedBytes: 16_000_000_000,
      hasDatapoint: false,
      windowHours: 336,
      nodegroupCreateTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(nodegroup.region).toBe(region);
    expect(nodegroup.accountId).toBe('999999999999');
    expect(nodegroup.instanceType).toBe('c5.xlarge');
    expect(nodegroup.nodeCount).toBe(6);
    expect(nodegroup.suggestedNodeCount).toBe(3);
    expect(nodegroup.cpuAllocatableMillis).toBe(12000);
    expect(nodegroup.cpuRequestedMillis).toBe(3000);
    expect(nodegroup.memoryAllocatableBytes).toBe(64_000_000_000);
    expect(nodegroup.memoryRequestedBytes).toBe(16_000_000_000);
    expect(nodegroup.hasDatapoint).toBe(false);
    expect(nodegroup.windowHours).toBe(336);
    expect(nodegroup.nodegroupCreateTime).toBe(nodegroupCreateTime);
    expect(nodegroup.detectedAt).toBe(detectedAt);
    expect(nodegroup.tags).toEqual({ env: 'prod' });
  });
});
