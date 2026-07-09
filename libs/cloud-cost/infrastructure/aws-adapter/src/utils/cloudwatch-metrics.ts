// SPDX-License-Identifier: Apache-2.0
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  type Dimension,
  type Datapoint,
  type Statistic,
} from '@aws-sdk/client-cloudwatch';

export interface MetricWindow {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly periodSeconds: number;
}

/**
 * A CloudWatch window covering the last `windowHours`, with `Period` equal
 * to the whole window so AWS returns a single aggregate datapoint. This is
 * what every idle/underutilized scanner wants: "how much activity in the
 * lookback", not a time series.
 */
export function metricWindow(windowHours: number): MetricWindow {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowHours * 60 * 60 * 1000);
  return { startTime, endTime, periodSeconds: windowHours * 3600 };
}

/**
 * Fetches a metric's single aggregate datapoint over `window`. The common
 * `GetMetricStatisticsCommand` call every CloudWatch-based scanner used to
 * repeat by hand (see REVIEW.md #2). Returns `{}` (all fields `undefined`)
 * when AWS has no datapoint, so callers can do `dp.Sum ?? 0` unconditionally.
 */
export async function getMetricDatapoint(
  cw: CloudWatchClient,
  namespace: string,
  metricName: string,
  dimensions: Dimension[],
  window: MetricWindow,
  statistics: Statistic[] = ['Sum'],
): Promise<Datapoint> {
  const r = await cw.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions,
      StartTime: window.startTime,
      EndTime: window.endTime,
      Period: window.periodSeconds,
      Statistics: statistics,
    }),
  );
  return r.Datapoints?.[0] ?? {};
}

/** Sum of a single metric over `window`, `0` if there's no datapoint. */
export async function sumMetric(
  cw: CloudWatchClient,
  namespace: string,
  metricName: string,
  dimensions: Dimension[],
  window: MetricWindow,
): Promise<number> {
  const dp = await getMetricDatapoint(cw, namespace, metricName, dimensions, window, ['Sum']);
  return dp.Sum ?? 0;
}

/**
 * Sum of several metrics over `window`, added together (e.g. bytes in +
 * bytes out). Fetched in parallel, same dimensions for all of them.
 */
export async function sumMetrics(
  cw: CloudWatchClient,
  namespace: string,
  metricNames: string[],
  dimensions: Dimension[],
  window: MetricWindow,
): Promise<number> {
  const sums = await Promise.all(
    metricNames.map((metricName) => sumMetric(cw, namespace, metricName, dimensions, window)),
  );
  return sums.reduce((total, sum) => total + sum, 0);
}

/** Average of a single metric over `window`, `0` if there's no datapoint. */
export async function avgMetric(
  cw: CloudWatchClient,
  namespace: string,
  metricName: string,
  dimensions: Dimension[],
  window: MetricWindow,
): Promise<number> {
  const dp = await getMetricDatapoint(cw, namespace, metricName, dimensions, window, ['Average']);
  return dp.Average ?? 0;
}

/** Average + Maximum of a single metric over `window` (the CPU-style rightsizing signal). */
export async function avgMaxMetric(
  cw: CloudWatchClient,
  namespace: string,
  metricName: string,
  dimensions: Dimension[],
  window: MetricWindow,
): Promise<{ avg: number; max: number }> {
  const dp = await getMetricDatapoint(cw, namespace, metricName, dimensions, window, ['Average', 'Maximum']);
  return { avg: dp.Average ?? 0, max: dp.Maximum ?? 0 };
}
