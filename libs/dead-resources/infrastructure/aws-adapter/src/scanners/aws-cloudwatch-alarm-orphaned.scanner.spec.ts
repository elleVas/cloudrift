// SPDX-License-Identifier: Apache-2.0
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsCloudwatchAlarmOrphanedScanner } from './aws-cloudwatch-alarm-orphaned.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-cloudwatch');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsCloudwatchAlarmOrphanedScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

describe('AwsCloudwatchAlarmOrphanedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('cloudwatch-alarm-orphaned');
  });

  it('flags an old alarm stuck in INSUFFICIENT_DATA', async () => {
    mockSend.mockResolvedValueOnce({
      MetricAlarms: [
        { AlarmArn: 'arn:aws:cloudwatch:us-east-1:123:alarm:a1', AlarmName: 'a1', AlarmConfigurationUpdatedTimestamp: oldDate },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((a) => a.id)).toEqual(['arn:aws:cloudwatch:us-east-1:123:alarm:a1']);
  });

  it('does not flag an alarm reconfigured within the grace period', async () => {
    mockSend.mockResolvedValueOnce({
      MetricAlarms: [
        { AlarmArn: 'arn:aws:cloudwatch:us-east-1:123:alarm:a2', AlarmName: 'a2', AlarmConfigurationUpdatedTimestamp: new Date() },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeAlarmsCommand scoped to INSUFFICIENT_DATA', async () => {
    mockSend.mockResolvedValueOnce({ MetricAlarms: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeAlarmsCommand));
    const args = (DescribeAlarmsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.StateValue).toBe('INSUFFICIENT_DATA');
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
