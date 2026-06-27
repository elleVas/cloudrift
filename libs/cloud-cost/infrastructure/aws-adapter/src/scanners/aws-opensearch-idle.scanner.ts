// SPDX-License-Identifier: Apache-2.0
import {
  OpenSearchClient,
  ListDomainNamesCommand,
  DescribeDomainsCommand,
  type DomainStatus,
} from '@aws-sdk/client-opensearch';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { OpenSearchDomain, OpenSearchIdleDomainPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;
/** `DescribeDomains` accepts at most 5 domain names per call. */
const DESCRIBE_DOMAINS_BATCH_SIZE = 5;

export interface OpenSearchInstancePricingSource {
  getOpenSearchInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

/**
 * Detects OpenSearch/Elasticsearch domains with zero search/indexing
 * traffic in the observed window. Requires `--live-pricing`: without a
 * price per instance type, no saving can be estimated.
 */
export class AwsOpenSearchIdleScanner implements WasteScannerPort {
  readonly kind = 'opensearch-idle-domain' as const;

  constructor(
    private readonly pricing: OpenSearchInstancePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new OpenSearchIdleDomainPolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const opensearch = new OpenSearchClient({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const names = await opensearch.send(new ListDomainNamesCommand({}));
      const domainNames = (names.DomainNames ?? []).map((d) => d.DomainName).filter((n): n is string => !!n);
      if (domainNames.length === 0) return Result.ok([]);

      const domains: DomainStatus[] = [];
      for (let i = 0; i < domainNames.length; i += DESCRIBE_DOMAINS_BATCH_SIZE) {
        const batch = domainNames.slice(i, i + DESCRIBE_DOMAINS_BATCH_SIZE);
        const r = await opensearch.send(new DescribeDomainsCommand({ DomainNames: batch }));
        domains.push(...(r.DomainStatusList ?? []));
      }

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const requests = await mapWithConcurrency(domains, CLOUDWATCH_CONCURRENCY, (domain) =>
        this.sumRequests(cw, this.accountId, domain.DomainName!, startTime, endTime, periodSeconds),
      );

      const instanceTypes = [...new Set(domains.map((d) => d.ClusterConfig?.InstanceType ?? 'unknown'))];
      const priceEntries = await mapWithConcurrency(instanceTypes, CLOUDWATCH_CONCURRENCY, async (instanceType) => ({
        instanceType,
        price: (await this.pricing.getOpenSearchInstancePricePerMonth(region, instanceType)) ?? 0,
      }));
      const priceByType = new Map(priceEntries.map((e) => [e.instanceType, e.price]));

      const now = new Date();
      const idle = domains
        .map((domain, index) => {
          const instanceType = domain.ClusterConfig?.InstanceType ?? 'unknown';
          const instanceCount = domain.ClusterConfig?.InstanceCount ?? 1;
          const monthlyPrice = (priceByType.get(instanceType) ?? 0) * instanceCount;
          return new OpenSearchDomain({
            domainName: domain.DomainName!,
            region,
            accountId: this.accountId,
            instanceType,
            instanceCount,
            requestsLastWindow: requests[index],
            metricWindowHours: this.windowHours,
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +monthlyPrice.toFixed(4),
          });
        })
        .filter((domain) => this.policy.evaluate(domain, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('OpenSearch', err as Error));
    } finally {
      opensearch.destroy();
      cw.destroy();
    }
  }

  private async sumRequests(
    cw: CloudWatchClient,
    clientId: string,
    domainName: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const [search, indexing] = await Promise.all(
      ['SearchRate', 'IndexingRate'].map((metricName) =>
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/ES',
            MetricName: metricName,
            Dimensions: [
              { Name: 'ClientId', Value: clientId },
              { Name: 'DomainName', Value: domainName },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: ['Sum'],
          }),
        ),
      ),
    );
    return (search.Datapoints?.[0]?.Sum ?? 0) + (indexing.Datapoints?.[0]?.Sum ?? 0);
  }
}
