// SPDX-License-Identifier: Apache-2.0
import {
  OpenSearchClient,
  ListDomainNamesCommand,
  DescribeDomainsCommand,
  type DomainStatus,
} from '@aws-sdk/client-opensearch';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { OpenSearchDomain, OpenSearchIdleDomainPolicy, type WastePolicy } from 'cloud-cost-domain';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');
/** `DescribeDomains` accepts at most 5 domain names per call. */
const DESCRIBE_DOMAINS_BATCH_SIZE = 5;

export interface OpenSearchInstancePricingSource {
  getOpenSearchInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

type DomainWithName = DomainStatus & { DomainName: string };

/**
 * Detects OpenSearch/Elasticsearch domains with zero search/indexing
 * traffic in the observed window. Requires `--live-pricing`: without a
 * price per instance type, no saving can be estimated.
 */
export class AwsOpenSearchIdleScanner extends CloudWatchIdleScanner<
  OpenSearchClient,
  DomainWithName,
  number,
  OpenSearchDomain
> {
  readonly kind = 'opensearch-idle-domain' as const;
  protected readonly serviceLabel = 'OpenSearch';

  constructor(
    private readonly pricing: OpenSearchInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<OpenSearchDomain> = new OpenSearchIdleDomainPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): OpenSearchClient {
    return new OpenSearchClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: OpenSearchClient): void {
    client.destroy();
  }

  protected async listResources(client: OpenSearchClient): Promise<DomainWithName[]> {
    const names = await client.send(new ListDomainNamesCommand({}));
    const domainNames = (names.DomainNames ?? []).map((d) => d.DomainName).filter((n): n is string => !!n);
    if (domainNames.length === 0) return [];

    const domains: DomainStatus[] = [];
    for (let i = 0; i < domainNames.length; i += DESCRIBE_DOMAINS_BATCH_SIZE) {
      const batch = domainNames.slice(i, i + DESCRIBE_DOMAINS_BATCH_SIZE);
      const r = await client.send(new DescribeDomainsCommand({ DomainNames: batch }));
      domains.push(...(r.DomainStatusList ?? []));
    }
    const valid = domains.filter((d): d is DomainWithName => !!d.DomainName);
    if (valid.length !== domains.length) {
      logger.debug(`${this.kind}: skipped ${domains.length - valid.length} entries missing DomainName`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, domain: DomainWithName, window: MetricWindow) {
    return sumMetrics(
      cw,
      'AWS/ES',
      ['SearchRate', 'IndexingRate'],
      [
        { Name: 'ClientId', Value: this.accountId },
        { Name: 'DomainName', Value: domain.DomainName },
      ],
      window,
    );
  }

  protected override async resolvePrices(raw: DomainWithName[], region: AwsRegion): Promise<Map<string, number>> {
    const instanceTypes = [...new Set(raw.map((d) => d.ClusterConfig?.InstanceType ?? 'unknown'))];
    const entries = await mapWithConcurrency(instanceTypes, PRICING_CONCURRENCY, async (instanceType) => ({
      instanceType,
      price: (await this.pricing.getOpenSearchInstancePricePerMonth(region, instanceType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceType, e.price]));
  }

  protected toEntity(
    domain: DomainWithName,
    requestsLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): OpenSearchDomain {
    const instanceType = domain.ClusterConfig?.InstanceType ?? 'unknown';
    const instanceCount = domain.ClusterConfig?.InstanceCount ?? 1;
    const monthlyPrice = (prices.get(instanceType) ?? 0) * instanceCount;
    return new OpenSearchDomain({
      domainName: domain.DomainName,
      region,
      accountId: this.accountId,
      instanceType,
      instanceCount,
      requestsLastWindow,
      metricWindowHours: this.windowHours,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: +monthlyPrice.toFixed(4),
    });
  }
}
