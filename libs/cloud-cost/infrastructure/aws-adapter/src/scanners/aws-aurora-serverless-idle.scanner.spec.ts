// SPDX-License-Identifier: Apache-2.0
import { RDSClient } from '@aws-sdk/client-rds';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsAuroraServerlessIdleScanner, suggestMinAcu } from './aws-aurora-serverless-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-rds');
jest.mock('@aws-sdk/client-cloudwatch');

const mockRdsSend = jest.fn();
const mockRdsDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (RDSClient as jest.Mock).mockImplementation(() => ({ send: mockRdsSend, destroy: mockRdsDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsAuroraServerlessIdleScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function mockServerlessV2Cluster(
  id: string,
  { minAcu = 8, maxAcu = 16, createTime = OLD_DATE }: { minAcu?: number; maxAcu?: number; createTime?: Date } = {},
) {
  mockRdsSend.mockResolvedValueOnce({
    DBClusters: [
      {
        DBClusterIdentifier: id,
        Engine: 'aurora-postgresql',
        ServerlessV2ScalingConfiguration: { MinCapacity: minAcu, MaxCapacity: maxAcu },
        ClusterCreateTime: createTime,
        TagList: [],
      },
    ],
  });
}

function mockPeak(acu: number) {
  mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Maximum: acu }] });
}

describe('suggestMinAcu', () => {
  it('adds a 20% margin and rounds up to 0.5-ACU granularity', () => {
    expect(suggestMinAcu(2)).toBe(2.5); // 2 * 1.2 = 2.4 → 2.5
    expect(suggestMinAcu(5)).toBe(6); // 5 * 1.2 = 6.0 → 6
  });

  it('never drops below the 0.5 ACU floor', () => {
    expect(suggestMinAcu(0)).toBe(0.5);
    expect(suggestMinAcu(0.1)).toBe(0.5);
  });
});

describe('AwsAuroraServerlessIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('aurora-serverless-overprovisioned');
  });

  it('reports a cluster whose peak ACU is far below the Min ACU floor', async () => {
    mockServerlessV2Cluster('billing-db', { minAcu: 8 });
    mockPeak(2); // 2 < 8 * 0.5 → overprovisioned

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(['billing-db']);
    // suggested = suggestMinAcu(2) = 2.5; saving = (8 - 2.5) * 87.6
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(5.5 * 87.6, 2);
  });

  it('does not report a cluster whose peak ACU is above the threshold', async () => {
    mockServerlessV2Cluster('busy-db', { minAcu: 8 });
    mockPeak(6); // 6 >= 8 * 0.5 → not overprovisioned

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a just-created cluster within the grace period', async () => {
    mockServerlessV2Cluster('fresh-db', { minAcu: 8, createTime: new Date() });
    mockPeak(2);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report when there is no Min ACU reduction left after rounding', async () => {
    mockServerlessV2Cluster('tiny-db', { minAcu: 0.5, maxAcu: 4 });
    mockPeak(0.1); // suggested rounds back up to 0.5 = current Min ACU → nothing to lower

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a cluster with no ServerlessDatabaseCapacity datapoint at all (no evidence, not confirmed idle)', async () => {
    mockServerlessV2Cluster('untagged-metric-db', { minAcu: 8 });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }); // CloudWatch has nothing for this window

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores clusters that are not Serverless v2 (no Min ACU floor)', async () => {
    mockRdsSend.mockResolvedValueOnce({
      DBClusters: [{ DBClusterIdentifier: 'provisioned-db', Engine: 'aurora-mysql' }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries ServerlessDatabaseCapacity (Maximum) from the AWS/RDS namespace', async () => {
    mockServerlessV2Cluster('billing-db');
    mockPeak(2);

    await scanner.scan(region);

    const args = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Namespace).toBe('AWS/RDS');
    expect(args.MetricName).toBe('ServerlessDatabaseCapacity');
    expect(args.Dimensions).toEqual([{ Name: 'DBClusterIdentifier', Value: 'billing-db' }]);
    expect(args.Statistics).toEqual(['Maximum']);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockRdsSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('Aurora');
    expect(mockRdsDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
