// SPDX-License-Identifier: Apache-2.0
import { KinesisClient } from '@aws-sdk/client-kinesis';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsKinesisIdleScanner } from './aws-kinesis-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-kinesis');
jest.mock('@aws-sdk/client-cloudwatch');

const mockKinesisSend = jest.fn();
const mockKinesisDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (KinesisClient as jest.Mock).mockImplementation(() => ({ send: mockKinesisSend, destroy: mockKinesisDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsKinesisIdleScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function mockProvisionedStream(name: string, openShardCount = 2) {
  mockKinesisSend.mockResolvedValueOnce({ StreamNames: [name], HasMoreStreams: false });
  mockKinesisSend.mockResolvedValueOnce({
    StreamDescriptionSummary: {
      StreamName: name,
      StreamModeDetails: { StreamMode: 'PROVISIONED' },
      OpenShardCount: openShardCount,
      StreamCreationTimestamp: OLD_DATE,
    },
  });
}

describe('AwsKinesisIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('kinesis-provisioned-idle-stream');
  });

  it('reports an old Provisioned stream with zero incoming activity', async () => {
    mockProvisionedStream('stream-1', 2);
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual(['stream-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(10.95 * 2, 2);
  });

  it('does not report a stream with incoming activity', async () => {
    mockProvisionedStream('stream-busy');
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 5000 }] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores On-Demand streams entirely', async () => {
    mockKinesisSend.mockResolvedValueOnce({ StreamNames: ['stream-od'], HasMoreStreams: false });
    mockKinesisSend.mockResolvedValueOnce({
      StreamDescriptionSummary: {
        StreamName: 'stream-od',
        StreamModeDetails: { StreamMode: 'ON_DEMAND' },
        OpenShardCount: 4,
        StreamCreationTimestamp: OLD_DATE,
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('skips CloudWatch entirely when no streams exist', async () => {
    mockKinesisSend.mockResolvedValueOnce({ StreamNames: [], HasMoreStreams: false });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries IncomingBytes/IncomingRecords from the AWS/Kinesis namespace', async () => {
    mockProvisionedStream('stream-1');
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const calls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls;
    expect(calls[0][0].Namespace).toBe('AWS/Kinesis');
    expect(calls[0][0].MetricName).toBe('IncomingBytes');
    expect(calls[0][0].Dimensions).toEqual([{ Name: 'StreamName', Value: 'stream-1' }]);
    expect(calls[1][0].MetricName).toBe('IncomingRecords');
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockKinesisSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('Kinesis');
    expect(mockKinesisDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
