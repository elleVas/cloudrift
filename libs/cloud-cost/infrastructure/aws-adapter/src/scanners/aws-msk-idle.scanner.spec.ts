// SPDX-License-Identifier: Apache-2.0
import { KafkaClient, ListClustersV2Command } from '@aws-sdk/client-kafka';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsMskIdleScanner } from './aws-msk-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-kafka');
jest.mock('@aws-sdk/client-cloudwatch');

const mockKafkaSend = jest.fn();
const mockKafkaDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (KafkaClient as jest.Mock).mockImplementation(() => ({ send: mockKafkaSend, destroy: mockKafkaDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getMskBrokerPricePerMonth: jest.fn().mockResolvedValue(120) };
const scanner = new AwsMskIdleScanner(mockPricingSource);
const OLD_DATE = new Date('2024-03-01');

function mockCluster(name: string, brokers = 3) {
  mockKafkaSend.mockResolvedValueOnce({
    ClusterInfoList: [
      {
        ClusterName: name,
        CreationTime: OLD_DATE,
        Tags: { env: 'prod' },
        Provisioned: { BrokerNodeGroupInfo: { InstanceType: 'kafka.m5.large' }, NumberOfBrokerNodes: brokers },
      },
    ],
  });
}

describe('AwsMskIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('msk-idle-cluster');
  });

  it('reports an old cluster with zero broker traffic', async () => {
    mockCluster('cluster-1', 3);
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(['cluster-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(120 * 3, 2);
    expect(result.value[0].tags).toEqual({ env: 'prod' });
  });

  it('does not report a cluster with broker traffic', async () => {
    mockCluster('busy');
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 5000 }] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters on PROVISIONED clusters only', async () => {
    mockKafkaSend.mockResolvedValueOnce({ ClusterInfoList: [] });

    await scanner.scan(region);

    const args = (ListClustersV2Command as unknown as jest.Mock).mock.calls[0][0];
    expect(args.ClusterTypeFilter).toBe('PROVISIONED');
  });

  it('skips CloudWatch entirely when no clusters exist', async () => {
    mockKafkaSend.mockResolvedValueOnce({ ClusterInfoList: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries BytesInPerSec/BytesOutPerSec from the AWS/Kafka namespace', async () => {
    mockCluster('cluster-1');
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const calls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls;
    expect(calls[0][0].Namespace).toBe('AWS/Kafka');
    expect(calls[0][0].MetricName).toBe('BytesInPerSec');
    expect(calls[0][0].Dimensions).toEqual([{ Name: 'Cluster Name', Value: 'cluster-1' }]);
    expect(calls[1][0].MetricName).toBe('BytesOutPerSec');
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockKafkaSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('MSK');
    expect(mockKafkaDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
