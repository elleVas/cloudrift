// SPDX-License-Identifier: Apache-2.0
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { AwsLogsLogGroupEmptyScanner } from './aws-logs-loggroup-empty.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-cloudwatch-logs');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CloudWatchLogsClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsLogsLogGroupEmptyScanner();
const oldTime = Date.now() - 200 * 24 * 60 * 60 * 1000;

describe('AwsLogsLogGroupEmptyScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('logs-loggroup-empty');
  });

  it('flags an old log group with zero stored bytes', async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [{ arn: 'arn:aws:logs:us-east-1:123:log-group:/lg-1', logGroupName: '/lg-1', creationTime: oldTime, storedBytes: 0 }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((lg) => lg.id)).toEqual(['arn:aws:logs:us-east-1:123:log-group:/lg-1']);
  });

  it('does not flag a log group that has stored bytes', async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [{ arn: 'arn:aws:logs:us-east-1:123:log-group:/lg-2', logGroupName: '/lg-2', creationTime: oldTime, storedBytes: 1024 }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a log group created within the grace period', async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [{ arn: 'arn:aws:logs:us-east-1:123:log-group:/lg-3', logGroupName: '/lg-3', creationTime: Date.now(), storedBytes: 0 }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeLogGroupsCommand', async () => {
    mockSend.mockResolvedValueOnce({ logGroups: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeLogGroupsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
