// SPDX-License-Identifier: Apache-2.0
import {
  LambdaClient,
  ListFunctionsCommand,
  type FunctionConfiguration,
} from '@aws-sdk/client-lambda';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { UnderutilizedLambdaFunction, LambdaUnderutilizedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_WINDOW_HOURS = 168;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Detects Lambda functions with (almost) zero invocations in the observed
 * window. Lambda is pay-per-use: without invocations the direct cost is $0
 * (Provisioned Concurrency is not detected here) — the value is
 * hygiene/cleanup, not a dollar saving.
 */
export class AwsLambdaUnderutilizedScanner implements WasteScannerPort {
  readonly kind = 'lambda-underutilized' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new LambdaUnderutilizedPolicy(),
    private readonly windowHours = DEFAULT_WINDOW_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const lambda = new LambdaClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const rawFunctions = await paginate<FunctionConfiguration>(async (cursor) => {
        const r = await lambda.send(new ListFunctionsCommand({ Marker: cursor }));
        return { items: r.Functions ?? [], cursor: r.NextMarker };
      });

      if (rawFunctions.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const invocations = await mapWithConcurrency(rawFunctions, CLOUDWATCH_CONCURRENCY, (fn) =>
        this.sumInvocations(cw, fn.FunctionName!, startTime, endTime, periodSeconds),
      );

      const now = new Date();
      const functions = rawFunctions
        .map((fn, index) =>
          new UnderutilizedLambdaFunction({
            functionName: fn.FunctionName!,
            region,
            accountId: this.accountId,
            memorySizeMb: fn.MemorySize ?? 0,
            invocationsLastWindow: invocations[index],
            windowDays: +(this.windowHours / 24).toFixed(1),
            lastModified: fn.LastModified ? new Date(fn.LastModified) : new Date(0),
            detectedAt: now,
            tags: {},
          }),
        )
        .filter((fn) => this.policy.evaluate(fn, now).isWaste);

      return Result.ok(functions);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Lambda', err as Error));
    } finally {
      lambda.destroy();
      cw.destroy();
    }
  }

  private async sumInvocations(
    cw: CloudWatchClient,
    functionName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: 'Invocations',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Sum'],
      }),
    );
    return r.Datapoints?.[0]?.Sum ?? 0;
  }
}
