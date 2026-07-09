// SPDX-License-Identifier: Apache-2.0
import { LambdaClient, ListFunctionsCommand, type FunctionConfiguration } from '@aws-sdk/client-lambda';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { UnderutilizedLambdaFunction, LambdaUnderutilizedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_WINDOW_HOURS = 168;
const logger = createLogger('cloudrift:scanner');

type FunctionWithName = FunctionConfiguration & { FunctionName: string };

export class AwsLambdaUnderutilizedScanner extends CloudWatchIdleScanner<
  LambdaClient,
  FunctionWithName,
  number,
  UnderutilizedLambdaFunction
> {
  readonly kind = 'lambda-underutilized' as const;
  protected readonly serviceLabel = 'Lambda';

  constructor(
    private readonly accountId = 'unknown',
    policy: WastePolicy<UnderutilizedLambdaFunction> = new LambdaUnderutilizedPolicy(),
    windowHours = DEFAULT_WINDOW_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): LambdaClient {
    return new LambdaClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: LambdaClient): void {
    client.destroy();
  }

  protected async listResources(client: LambdaClient): Promise<FunctionWithName[]> {
    const functions = await paginate<FunctionConfiguration>(async (cursor) => {
      const r = await client.send(new ListFunctionsCommand({ Marker: cursor }));
      return { items: r.Functions ?? [], cursor: r.NextMarker };
    });
    const valid = functions.filter((fn): fn is FunctionWithName => !!fn.FunctionName);
    if (valid.length !== functions.length) {
      logger.debug(`${this.kind}: skipped ${functions.length - valid.length} entries missing FunctionName`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, fn: FunctionWithName, window: MetricWindow) {
    return sumMetric(cw, 'AWS/Lambda', 'Invocations', [{ Name: 'FunctionName', Value: fn.FunctionName }], window);
  }

  protected toEntity(
    fn: FunctionWithName,
    invocationsLastWindow: number,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): UnderutilizedLambdaFunction {
    return new UnderutilizedLambdaFunction({
      functionName: fn.FunctionName,
      region,
      accountId: this.accountId,
      memorySizeMb: fn.MemorySize ?? 0,
      invocationsLastWindow,
      windowDays: +(this.windowHours / 24).toFixed(1),
      lastModified: fn.LastModified ? new Date(fn.LastModified) : new Date(0),
      detectedAt: now,
      tags: {},
    });
  }
}
