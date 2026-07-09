// SPDX-License-Identifier: Apache-2.0
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { metricWindow, getMetricDatapoint, sumMetric, sumMetrics, avgMetric, avgMaxMetric } from './cloudwatch-metrics';

jest.mock('@aws-sdk/client-cloudwatch');

const mockSend = jest.fn();
const cw = new CloudWatchClient({});
const dimensions = [{ Name: 'VolumeId', Value: 'vol-1' }];

beforeEach(() => {
  jest.clearAllMocks();
  (cw as unknown as { send: typeof mockSend }).send = mockSend;
});

describe('metricWindow', () => {
  it('spans exactly windowHours, with Period equal to the whole window', () => {
    const window = metricWindow(48);
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(48 * 60 * 60 * 1000);
    expect(window.periodSeconds).toBe(48 * 3600);
  });
});

describe('getMetricDatapoint', () => {
  it('builds the command from namespace/metric/dimensions/window/statistics', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 42 }] });
    const window = metricWindow(48);

    const dp = await getMetricDatapoint(cw, 'AWS/EBS', 'VolumeReadOps', dimensions, window, ['Sum']);

    expect(dp).toEqual({ Sum: 42 });
    const cmdArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmdArgs).toEqual({
      Namespace: 'AWS/EBS',
      MetricName: 'VolumeReadOps',
      Dimensions: dimensions,
      StartTime: window.startTime,
      EndTime: window.endTime,
      Period: window.periodSeconds,
      Statistics: ['Sum'],
    });
  });

  it('returns {} when AWS has no datapoint', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [] });
    const dp = await getMetricDatapoint(cw, 'AWS/EBS', 'VolumeReadOps', dimensions, metricWindow(48));
    expect(dp).toEqual({});
  });
});

describe('sumMetric', () => {
  it('returns the Sum datapoint', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 123 }] });
    expect(await sumMetric(cw, 'AWS/Lambda', 'Invocations', dimensions, metricWindow(168))).toBe(123);
  });

  it('returns 0 when there is no datapoint', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [] });
    expect(await sumMetric(cw, 'AWS/Lambda', 'Invocations', dimensions, metricWindow(168))).toBe(0);
  });
});

describe('sumMetrics', () => {
  it('adds several metrics fetched in parallel', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 10 }] });
    mockSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 5 }] });

    const total = await sumMetrics(cw, 'AWS/FSx', ['DataReadBytes', 'DataWriteBytes'], dimensions, metricWindow(48));

    expect(total).toBe(15);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns 0 for an empty metric list', async () => {
    expect(await sumMetrics(cw, 'AWS/FSx', [], dimensions, metricWindow(48))).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('avgMetric', () => {
  it('returns the Average datapoint', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [{ Average: 7.5 }] });
    expect(await avgMetric(cw, 'AWS/S3', 'BucketSizeBytes', dimensions, metricWindow(48))).toBe(7.5);
  });
});

describe('avgMaxMetric', () => {
  it('returns both Average and Maximum from the same datapoint', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [{ Average: 12.3, Maximum: 55 }] });

    const stats = await avgMaxMetric(cw, 'AWS/EC2', 'CPUUtilization', dimensions, metricWindow(168));

    expect(stats).toEqual({ avg: 12.3, max: 55 });
    const cmdArgs = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmdArgs.Statistics).toEqual(['Average', 'Maximum']);
  });

  it('defaults to 0/0 when there is no datapoint', async () => {
    mockSend.mockResolvedValueOnce({ Datapoints: [] });
    expect(await avgMaxMetric(cw, 'AWS/EC2', 'CPUUtilization', dimensions, metricWindow(168))).toEqual({
      avg: 0,
      max: 0,
    });
  });
});
