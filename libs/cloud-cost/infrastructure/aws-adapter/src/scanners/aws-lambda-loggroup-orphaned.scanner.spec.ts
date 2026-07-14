// SPDX-License-Identifier: Apache-2.0
import { CloudWatchLogsClient, DescribeLogStreamsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { AwsLambdaLogGroupOrphanedScanner } from './aws-lambda-loggroup-orphaned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-cloudwatch-logs');
jest.mock('@aws-sdk/client-lambda');

const mockLogsSend = jest.fn();
const mockLogsDestroy = jest.fn();
const mockLambdaSend = jest.fn();
const mockLambdaDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CloudWatchLogsClient as jest.Mock).mockImplementation(() => ({ send: mockLogsSend, destroy: mockLogsDestroy }));
  (LambdaClient as jest.Mock).mockImplementation(() => ({ send: mockLambdaSend, destroy: mockLambdaDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsLambdaLogGroupOrphanedScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01').getTime();

describe('AwsLambdaLogGroupOrphanedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('lambda-loggroup-orphaned');
  });

  it('reports a log group whose function no longer exists', async () => {
    mockLogsSend
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: '/aws/lambda/deleted-fn', storedBytes: 1024 ** 3 }],
      })
      .mockResolvedValueOnce({ logStreams: [{ lastEventTimestamp: OLD_DATE }] });
    mockLambdaSend.mockResolvedValueOnce({ Functions: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((g) => g.id)).toEqual(['/aws/lambda/deleted-fn']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(0.03, 2);
  });

  it('does not report a log group whose function still exists', async () => {
    mockLogsSend.mockResolvedValueOnce({
      logGroups: [{ logGroupName: '/aws/lambda/live-fn', storedBytes: 1024 ** 3 }],
    });
    mockLambdaSend.mockResolvedValueOnce({ Functions: [{ FunctionName: 'live-fn' }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    // No DescribeLogStreams call for a candidate whose function is still active.
    expect(mockLogsSend).toHaveBeenCalledTimes(1);
  });

  it('does not report an orphaned log group within the last-event grace period', async () => {
    mockLogsSend
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: '/aws/lambda/just-deleted', storedBytes: 1024 ** 3 }],
      })
      .mockResolvedValueOnce({ logStreams: [{ lastEventTimestamp: Date.now() }] });
    mockLambdaSend.mockResolvedValueOnce({ Functions: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('treats a log group with no streams as never logged (definitely orphaned)', async () => {
    mockLogsSend
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: '/aws/lambda/empty-fn', storedBytes: 0 }],
      })
      .mockResolvedValueOnce({ logStreams: [] });
    mockLambdaSend.mockResolvedValueOnce({ Functions: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('queries DescribeLogStreams ordered by LastEventTime, most recent first', async () => {
    mockLogsSend
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: '/aws/lambda/deleted-fn', storedBytes: 1024 ** 3 }],
      })
      .mockResolvedValueOnce({ logStreams: [{ lastEventTimestamp: OLD_DATE }] });
    mockLambdaSend.mockResolvedValueOnce({ Functions: [] });

    await scanner.scan(region);

    const args = (DescribeLogStreamsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.logGroupName).toBe('/aws/lambda/deleted-fn');
    expect(args.orderBy).toBe('LastEventTime');
    expect(args.descending).toBe(true);
    expect(args.limit).toBe(1);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockLogsSend.mockRejectedValueOnce(new Error('boom'));
    mockLambdaSend.mockResolvedValueOnce({ Functions: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('CloudWatchLogs');
    expect(mockLogsDestroy).toHaveBeenCalledTimes(1);
    expect(mockLambdaDestroy).toHaveBeenCalledTimes(1);
  });
});
