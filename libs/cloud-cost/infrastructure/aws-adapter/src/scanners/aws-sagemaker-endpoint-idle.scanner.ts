// SPDX-License-Identifier: Apache-2.0
import {
  SageMakerClient,
  ListEndpointsCommand,
  DescribeEndpointCommand,
  DescribeEndpointConfigCommand,
  type EndpointSummary,
} from '@aws-sdk/client-sagemaker';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { SageMakerEndpointIdle, SageMakerEndpointIdlePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 168;
const DESCRIBE_CONCURRENCY = 5;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface SageMakerEndpointInstancePricingSource {
  getSageMakerEndpointInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

interface EndpointDetail {
  endpointName: string;
  endpointConfigName: string;
  status: string;
  creationTime: Date;
  instanceType: string;
  instanceCount: number;
  variantNames: string[];
}

/**
 * Detects SageMaker real-time inference endpoints `InService` with zero
 * invocations over the window. `ListEndpoints`/`DescribeEndpoint` don't
 * expose the hosted instance type — resolving it requires an extra
 * `DescribeEndpointConfig` call per endpoint (beyond the 3 read actions
 * listed in the original vertical plan), documented in the README IAM
 * block. Requires `--live-pricing`: without a price per instance type, no
 * saving can be estimated.
 */
export class AwsSageMakerEndpointIdleScanner extends CloudWatchIdleScanner<
  SageMakerClient,
  EndpointDetail,
  number,
  SageMakerEndpointIdle
> {
  readonly kind = 'sagemaker-endpoint-idle' as const;
  protected readonly serviceLabel = 'SageMaker';

  constructor(
    private readonly pricing: SageMakerEndpointInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<SageMakerEndpointIdle> = new SageMakerEndpointIdlePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): SageMakerClient {
    return new SageMakerClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: SageMakerClient): void {
    client.destroy();
  }

  protected async listResources(client: SageMakerClient): Promise<EndpointDetail[]> {
    const summaries = await paginate<EndpointSummary>(async (cursor) => {
      const r = await client.send(new ListEndpointsCommand({ StatusEquals: 'InService', NextToken: cursor }));
      return { items: r.Endpoints ?? [], cursor: r.NextToken };
    });
    const named = summaries.filter((e): e is EndpointSummary & { EndpointName: string } => !!e.EndpointName);
    if (named.length !== summaries.length) {
      logger.debug(`${this.kind}: skipped ${summaries.length - named.length} entries missing EndpointName`);
    }

    const details = await mapWithConcurrency(named, DESCRIBE_CONCURRENCY, async (summary) => {
      const endpoint = await client.send(new DescribeEndpointCommand({ EndpointName: summary.EndpointName }));
      const endpointConfigName = endpoint.EndpointConfigName;
      if (!endpointConfigName) return undefined;

      const config = await client.send(new DescribeEndpointConfigCommand({ EndpointConfigName: endpointConfigName }));
      const variants = config.ProductionVariants ?? [];
      const primary = variants[0];
      if (!primary?.InstanceType) return undefined;
      if (variants.length > 1) {
        logger.debug(`${this.kind}: ${summary.EndpointName} has ${variants.length} variants, pricing the first only`);
      }

      const detail: EndpointDetail = {
        endpointName: summary.EndpointName,
        endpointConfigName,
        status: endpoint.EndpointStatus ?? summary.EndpointStatus ?? 'Unknown',
        creationTime: endpoint.CreationTime ?? summary.CreationTime ?? new Date(0),
        instanceType: primary.InstanceType,
        instanceCount: primary.InitialInstanceCount ?? 1,
        variantNames: variants.map((v) => v.VariantName).filter((n): n is string => !!n),
      };
      return detail;
    });

    return details.filter((d): d is EndpointDetail => d !== undefined);
  }

  protected async fetchMetric(
    cw: CloudWatchClient,
    _region: AwsRegion,
    endpoint: EndpointDetail,
    window: MetricWindow,
  ): Promise<number> {
    const sums = await Promise.all(
      endpoint.variantNames.map((variantName) =>
        sumMetric(
          cw,
          'AWS/SageMaker',
          'Invocations',
          [
            { Name: 'EndpointName', Value: endpoint.endpointName },
            { Name: 'VariantName', Value: variantName },
          ],
          window,
        ),
      ),
    );
    return sums.reduce((total, sum) => total + sum, 0);
  }

  protected override async resolvePrices(raw: EndpointDetail[], region: AwsRegion): Promise<Map<string, number>> {
    const instanceTypes = [...new Set(raw.map((e) => e.instanceType))];
    const entries = await mapWithConcurrency(instanceTypes, PRICING_CONCURRENCY, async (instanceType) => ({
      instanceType,
      price: (await this.pricing.getSageMakerEndpointInstancePricePerMonth(region, instanceType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceType, e.price]));
  }

  protected toEntity(
    endpoint: EndpointDetail,
    invocationsLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): SageMakerEndpointIdle {
    const monthlyPrice = (prices.get(endpoint.instanceType) ?? 0) * endpoint.instanceCount;
    return new SageMakerEndpointIdle({
      endpointName: endpoint.endpointName,
      region,
      accountId: this.accountId,
      endpointConfigName: endpoint.endpointConfigName,
      instanceType: endpoint.instanceType,
      instanceCount: endpoint.instanceCount,
      status: endpoint.status,
      invocationsLastWindow,
      windowHours: this.windowHours,
      creationTime: endpoint.creationTime,
      detectedAt: now,
      // Neither DescribeEndpoint nor DescribeEndpointConfig return tags.
      tags: {},
      monthlyCostUsd: +monthlyPrice.toFixed(4),
    });
  }
}
