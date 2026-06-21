import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { AwsLogGroupScanner } from './aws-log-group.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

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
const scanner = new AwsLogGroupScanner(mockPricing);
const OLD_DATE = new Date('2024-03-01');

describe('AwsLogGroupScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('log-group');
  });

  it('reports an old log group with no retention policy', async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [
        {
          logGroupName: '/aws/lambda/my-fn',
          storedBytes: 1024 ** 3,
          creationTime: OLD_DATE.getTime(),
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((lg) => lg.id)).toEqual(['/aws/lambda/my-fn']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(0.03, 2);
  });

  it('does not report a log group with a retention policy', async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [
        {
          logGroupName: '/aws/lambda/with-retention',
          storedBytes: 1024 ** 3,
          retentionInDays: 14,
          creationTime: OLD_DATE.getTime(),
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created log group (grace period)', async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [
        {
          logGroupName: '/aws/lambda/new-fn',
          storedBytes: 1024 ** 3,
          creationTime: new Date().getTime(),
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys the client on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('CloudWatchLogs');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
