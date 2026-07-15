// SPDX-License-Identifier: Apache-2.0
import { EKSClient } from '@aws-sdk/client-eks';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsEksNodeOverprovisionedScanner, suggestNodeCount } from './aws-eks-node-overprovisioned.scanner';
import type { EksNodeInstancePricingSource } from './aws-eks-node-overprovisioned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-eks');
jest.mock('@aws-sdk/client-cloudwatch');

const mockEksSend = jest.fn();
const mockEksDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();
const mockGetEc2InstancePrice = jest.fn();

const mockPricing: EksNodeInstancePricingSource = {
  getEc2InstancePricePerMonth: mockGetEc2InstancePrice,
};

beforeEach(() => {
  jest.clearAllMocks();
  (EKSClient as jest.Mock).mockImplementation(() => ({ send: mockEksSend, destroy: mockEksDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
  mockGetEc2InstancePrice.mockResolvedValue(70); // $/mo
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEksNodeOverprovisionedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function mockNodegroup(
  clusterName: string,
  nodegroupName: string,
  {
    desiredSize = 10,
    instanceTypes = ['m5.xlarge'],
    createdAt = OLD_DATE,
    status = 'ACTIVE',
  }: { desiredSize?: number; instanceTypes?: string[]; createdAt?: Date; status?: string } = {},
) {
  mockEksSend.mockResolvedValueOnce({ clusters: [clusterName] });
  mockEksSend.mockResolvedValueOnce({ nodegroups: [nodegroupName] });
  mockEksSend.mockResolvedValueOnce({
    nodegroup: {
      nodegroupName,
      clusterName,
      status,
      instanceTypes,
      scalingConfig: { desiredSize },
      createdAt,
      tags: {},
    },
  });
}

function mockUtilization(cpuRequest: number | undefined, cpuLimit: number | undefined, memRequest = 0, memLimit = 0) {
  mockCwSend.mockResolvedValueOnce({ Datapoints: cpuRequest === undefined ? [] : [{ Average: cpuRequest }] });
  mockCwSend.mockResolvedValueOnce({ Datapoints: cpuLimit === undefined ? [] : [{ Average: cpuLimit }] });
  mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Average: memRequest }] });
  mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Average: memLimit }] });
}

describe('suggestNodeCount', () => {
  it('scales down toward the 70% CPU-requested target, never below 1', () => {
    expect(suggestNodeCount(10, 17.5)).toBe(3); // 10 * 17.5/70 = 2.5 → ceil 3
    expect(suggestNodeCount(10, 0)).toBe(1);
  });

  it('never exceeds the current node count', () => {
    expect(suggestNodeCount(2, 90)).toBe(2);
  });

  it('returns 0 for a zero-size group', () => {
    expect(suggestNodeCount(0, 50)).toBe(0);
  });
});

describe('AwsEksNodeOverprovisionedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('eks-node-overprovisioned');
  });

  it('reports a node group whose CPU requested is far below allocatable', async () => {
    mockNodegroup('prod-cluster', 'app-workers', { desiredSize: 10 });
    mockUtilization(700, 4000); // 700/4000 = 17.5% < 30% → overprovisioned

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((n) => n.id)).toEqual(['prod-cluster/app-workers']);
    // suggested = suggestNodeCount(10, 17.5) = 3; saving = (10 - 3) * 70
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(7 * 70, 2);
  });

  it('does not report a node group whose CPU requested is above the threshold', async () => {
    mockNodegroup('prod-cluster', 'busy-workers', { desiredSize: 10 });
    mockUtilization(3500, 4000); // 87.5% >= 30% → not overprovisioned

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a just-created node group within the grace period', async () => {
    mockNodegroup('prod-cluster', 'fresh-workers', { desiredSize: 10, createdAt: new Date() });
    mockUtilization(700, 4000);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a single-node group with no reduction available', async () => {
    mockNodegroup('prod-cluster', 'tiny-workers', { desiredSize: 1 });
    mockUtilization(100, 4000);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a node group with no Container Insights datapoint (no evidence, not confirmed idle)', async () => {
    mockNodegroup('prod-cluster', 'no-insights-workers', { desiredSize: 10 });
    mockUtilization(undefined, undefined);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores node groups that are not ACTIVE', async () => {
    mockNodegroup('prod-cluster', 'creating-workers', { desiredSize: 10, status: 'CREATING' });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries Container Insights CPU/memory request+limit metrics keyed by cluster and node group', async () => {
    mockNodegroup('prod-cluster', 'app-workers');
    mockUtilization(700, 4000);

    await scanner.scan(region);

    const calls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(4);
    for (const args of calls) {
      expect(args.Namespace).toBe('ContainerInsights');
      expect(args.Dimensions).toEqual([
        { Name: 'ClusterName', Value: 'prod-cluster' },
        { Name: 'NodegroupName', Value: 'app-workers' },
      ]);
    }
    expect(calls.map((a) => a.MetricName)).toEqual([
      'node_cpu_request',
      'node_cpu_limit',
      'node_memory_request',
      'node_memory_limit',
    ]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockEksSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EKS');
    expect(mockEksDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
