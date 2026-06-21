import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsLambdaUnderutilizedScanner } from './aws-lambda-underutilized.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-cloudwatch');

const mockLambdaSend = jest.fn();
const mockLambdaDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (LambdaClient as jest.Mock).mockImplementation(() => ({
    send: mockLambdaSend,
    destroy: mockLambdaDestroy,
  }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsLambdaUnderutilizedScanner();
const OLD_DATE = new Date('2024-03-01');

describe('AwsLambdaUnderutilizedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('lambda-underutilized');
  });

  it('reports an old function with zero invocations', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Functions: [{ FunctionName: 'my-fn', MemorySize: 128, LastModified: OLD_DATE.toISOString() }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((fn) => fn.id)).toEqual(['my-fn']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBe(0);
  });

  it('does not report a function with invocations', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Functions: [{ FunctionName: 'busy-fn', MemorySize: 128, LastModified: OLD_DATE.toISOString() }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 42 }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly deployed function (grace period)', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Functions: [{ FunctionName: 'new-fn', MemorySize: 128, LastModified: new Date().toISOString() }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no functions exist', async () => {
    mockLambdaSend.mockResolvedValueOnce({ Functions: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries the Invocations metric per function', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Functions: [{ FunctionName: 'my-fn', MemorySize: 128, LastModified: OLD_DATE.toISOString() }],
    });
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const cwArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cwArgs.Namespace).toBe('AWS/Lambda');
    expect(cwArgs.MetricName).toBe('Invocations');
    expect(cwArgs.Dimensions).toEqual([{ Name: 'FunctionName', Value: 'my-fn' }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockLambdaSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('Lambda');
    expect(mockLambdaDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
