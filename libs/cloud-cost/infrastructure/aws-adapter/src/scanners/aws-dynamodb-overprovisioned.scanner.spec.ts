// SPDX-License-Identifier: Apache-2.0
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsDynamoDbOverprovisionedScanner } from './aws-dynamodb-overprovisioned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-cloudwatch');

const mockDynamoSend = jest.fn();
const mockDynamoDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (DynamoDBClient as jest.Mock).mockImplementation(() => ({
    send: mockDynamoSend,
    destroy: mockDynamoDestroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsDynamoDbOverprovisionedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

function describeTableResponse(overrides: Record<string, unknown> = {}) {
  return {
    Table: {
      TableName: 'my-table',
      CreationDateTime: OLD_DATE,
      BillingModeSummary: { BillingMode: 'PROVISIONED' },
      ProvisionedThroughput: { ReadCapacityUnits: 100, WriteCapacityUnits: 100 },
      ...overrides,
    },
  };
}

describe('AwsDynamoDbOverprovisionedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('dynamodb-overprovisioned');
  });

  it('reports an old provisioned table with near-zero consumed capacity', async () => {
    mockDynamoSend.mockResolvedValueOnce({ TableNames: ['my-table'] });
    mockDynamoSend.mockResolvedValueOnce(describeTableResponse());
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).toEqual(['my-table']);
  });

  it('does not report a PAY_PER_REQUEST table', async () => {
    mockDynamoSend.mockResolvedValueOnce({ TableNames: ['on-demand-table'] });
    mockDynamoSend.mockResolvedValueOnce(
      describeTableResponse({
        BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
        ProvisionedThroughput: { ReadCapacityUnits: 0, WriteCapacityUnits: 0 },
      }),
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('does not report a table with read utilization above threshold', async () => {
    mockDynamoSend.mockResolvedValueOnce({ TableNames: ['busy-table'] });
    mockDynamoSend.mockResolvedValueOnce(describeTableResponse({ TableName: 'busy-table' }));
    const consumed = 50 * 168 * 3600; // ~50% of 100 RCU over a 168h window
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: consumed }] });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 0 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created table (grace period)', async () => {
    mockDynamoSend.mockResolvedValueOnce({ TableNames: ['new-table'] });
    mockDynamoSend.mockResolvedValueOnce(
      describeTableResponse({ TableName: 'new-table', CreationDateTime: new Date() }),
    );
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('queries Consumed{Read,Write}CapacityUnits per table', async () => {
    mockDynamoSend.mockResolvedValueOnce({ TableNames: ['my-table'] });
    mockDynamoSend.mockResolvedValueOnce(describeTableResponse());
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });

    await scanner.scan(region);

    const metricNames = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls.map(
      (call) => call[0].MetricName,
    );
    expect(metricNames).toEqual(
      expect.arrayContaining(['ConsumedReadCapacityUnits', 'ConsumedWriteCapacityUnits']),
    );
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockDynamoSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('DynamoDB');
    expect(mockDynamoDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
