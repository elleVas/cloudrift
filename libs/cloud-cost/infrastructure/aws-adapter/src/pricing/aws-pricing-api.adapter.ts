// SPDX-License-Identifier: Apache-2.0
import {
  PricingClient,
  GetProductsCommand,
  type Filter,
} from '@aws-sdk/client-pricing';
import { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import type { PriceTable, RegionPrices } from './table-pricing.adapter';

/** The Pricing API only lives in some regions; us-east-1 is always valid. */
const PRICING_API_REGION = 'us-east-1';
/** AWS convention for converting hourly prices into monthly ones. */
const HOURS_PER_MONTH = 730;
/** Concurrent Pricing calls per region (the API has low rate limits). */
const PRICING_CONCURRENCY = 5;

/**
 * Maps region code → human-readable "location" used by the Pricing API.
 * Regions not present are left to the static price list.
 */
const REGION_TO_LOCATION: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'ca-central-1': 'Canada (Central)',
  'eu-west-1': 'EU (Ireland)',
  'eu-west-2': 'EU (London)',
  'eu-west-3': 'EU (Paris)',
  'eu-central-1': 'EU (Frankfurt)',
  'eu-north-1': 'EU (Stockholm)',
  'eu-south-1': 'EU (Milan)',
  'ap-east-1': 'Asia Pacific (Hong Kong)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'sa-east-1': 'South America (Sao Paulo)',
  'me-south-1': 'Middle East (Bahrain)',
  'af-south-1': 'Africa (Cape Town)',
};

/**
 * Maps RDS engine (value from `DescribeDBInstances`) → Pricing API
 * `databaseEngine`. Missing engines (e.g. Aurora variants) cause
 * `getRdsInstancePricePerMonth` to return `undefined`: better no price than
 * a wrong one.
 */
const RDS_ENGINE_TO_PRICING_ENGINE: Record<string, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  'oracle-se2': 'Oracle',
  'oracle-se2-cdb': 'Oracle',
  'oracle-ee': 'Oracle',
  'oracle-ee-cdb': 'Oracle',
  'sqlserver-ex': 'SQL Server',
  'sqlserver-web': 'SQL Server',
  'sqlserver-se': 'SQL Server',
  'sqlserver-ee': 'SQL Server',
};

type PriceUnit = 'gb-month' | 'hourly';

interface PriceSpec {
  /** Key in the PriceTable (must match the ones in prices.json). */
  key: string;
  serviceCode: string;
  /** TERM_MATCH filters in addition to `location` (added automatically). */
  filters: Array<{ Field: string; Value: string }>;
  unit: PriceUnit;
  /**
   * Extra client-side filter over each item's raw product attributes, for
   * products where the disambiguating value isn't its own filterable
   * `TERM_MATCH` attribute at all (e.g. MSK broker instance type is only
   * embedded in `usagetype`, like `EUC1-Kafka.t3.small` — the region-code
   * prefix rules out a `TERM_MATCH` on the full string). Applied in addition
   * to `filters`, before the distinct-price check.
   */
  matchAttributes?: (attributes: Record<string, string>) => boolean;
}

/**
 * Price specs fetched from the Pricing API. Each entry maps a PriceTable key
 * to an AWS product via ServiceCode + filters. The fetch routine is generic
 * and only accepts a price if the filters identify a single value (see
 * `fetchPrice`): ambiguous filters ⇒ fallback to the static list.
 */
const PRICE_SPECS: readonly PriceSpec[] = [
  ...(['gp3', 'gp2', 'io1', 'io2', 'st1', 'sc1', 'standard'] as const).map(
    (vol): PriceSpec => ({
      key: `ebs-${vol}`,
      serviceCode: 'AmazonEC2',
      filters: [
        { Field: 'productFamily', Value: 'Storage' },
        { Field: 'volumeApiName', Value: vol },
      ],
      unit: 'gb-month',
    }),
  ),
  {
    key: 'ebs-snapshot',
    serviceCode: 'AmazonEC2',
    filters: [{ Field: 'productFamily', Value: 'Storage Snapshot' }],
    unit: 'gb-month',
  },
  {
    key: 'nat-gateway',
    serviceCode: 'AmazonEC2',
    filters: [{ Field: 'productFamily', Value: 'NAT Gateway' }],
    unit: 'hourly',
  },
  {
    key: 'elastic-ip',
    serviceCode: 'AmazonEC2',
    filters: [
      { Field: 'productFamily', Value: 'IP Address' },
      { Field: 'group', Value: 'ElasticIP:IdleAddress' },
    ],
    unit: 'hourly',
  },
  // Phase 5.5 (ADR-0038): low-cardinality fixed-SKU prices, prefetched like
  // the specs above. Best-effort filters per ADR-0010: an ambiguous/wrong
  // match yields `undefined` and the static `prices.json` entry is used
  // instead — never a wrong price.
  ...(['WINDOWS', 'LUSTRE', 'ONTAP', 'OPENZFS'] as const).map(
    (fsType): PriceSpec => ({
      key: `fsx-${fsType.toLowerCase()}`,
      serviceCode: 'AmazonFSx',
      filters: [
        { Field: 'productFamily', Value: 'Storage' },
        { Field: 'fileSystemType', Value: fsType },
      ],
      unit: 'gb-month',
    }),
  ),
  {
    key: 'vpn-connection',
    serviceCode: 'AmazonVPC',
    filters: [{ Field: 'productFamily', Value: 'VPN Connection' }],
    unit: 'hourly',
  },
  {
    key: 'transit-gateway-attachment',
    serviceCode: 'AmazonVPC',
    filters: [{ Field: 'productFamily', Value: 'Transit Gateway' }],
    unit: 'hourly',
  },
  {
    key: 'kinesis-shard',
    serviceCode: 'AmazonKinesis',
    filters: [{ Field: 'productFamily', Value: 'Kinesis Streams' }, { Field: 'group', Value: 'Kinesis-ShardHour' }],
    unit: 'hourly',
  },
];

/**
 * Adapter that fetches prices from the AWS Pricing API. It does not
 * implement `PricingPort` directly: it produces a `PriceTable` via `warmUp`
 * that the composition root merges with the static price list and the
 * user's overrides.
 */
export class AwsPricingApiAdapter {
  constructor(
    private readonly client = new PricingClient({
      ...createAwsClientConfig(),
      region: PRICING_API_REGION,
    }),
  ) {}

  /**
   * Fetches prices for the requested regions and builds a PriceTable from
   * them. A missing key (unknown region, ambiguous filter, product not
   * found) is simply omitted: the merge leaves it to the static list.
   */
  async warmUp(regions: readonly AwsRegion[]): Promise<Result<PriceTable>> {
    try {
      const table: PriceTable = {};
      for (const region of regions) {
        const location = REGION_TO_LOCATION[region.code];
        if (!location) continue;

        const prices = await mapWithConcurrency(
          PRICE_SPECS,
          PRICING_CONCURRENCY,
          async (spec) => ({ key: spec.key, value: await this.fetchPrice(spec, location) }),
        );

        const regionPrices: RegionPrices = {};
        for (const { key, value } of prices) {
          if (value !== undefined) regionPrices[key] = value;
        }
        if (Object.keys(regionPrices).length > 0) table[region.code] = regionPrices;
      }
      return Result.ok(table);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Pricing', err as Error));
    }
  }

  /** Release the underlying HTTP connection pool. Call once after all scans complete. */
  dispose(): void {
    this.client.destroy();
  }

  /**
   * Monthly on-demand price for a single instance type, resolved on demand
   * (not part of `warmUp`/`PRICE_SPECS`: the cardinality of instance types
   * is too high for a prefetch). Should only be called for the types
   * actually observed during a scan.
   */
  async getEc2InstancePricePerMonth(
    region: AwsRegion,
    instanceType: string,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `ec2-${instanceType}`,
        serviceCode: 'AmazonEC2',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'productFamily', Value: 'Compute Instance' },
          { Field: 'tenancy', Value: 'Shared' },
          { Field: 'operatingSystem', Value: 'Linux' },
          { Field: 'preInstalledSw', Value: 'NA' },
          { Field: 'capacitystatus', Value: 'Used' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for an RDS instance class, resolved on demand
   * like `getEc2InstancePricePerMonth` (same reasoning: cardinality too high
   * for prefetch). Requires an engine → Pricing API engine mapping (see
   * `RDS_ENGINE_TO_PRICING_ENGINE`): unmapped engines (e.g. Aurora) return
   * `undefined`.
   */
  async getRdsInstancePricePerMonth(
    region: AwsRegion,
    dbInstanceClass: string,
    engine: string,
    multiAZ: boolean,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    const databaseEngine = RDS_ENGINE_TO_PRICING_ENGINE[engine];
    if (!databaseEngine) return undefined;
    return this.fetchPrice(
      {
        key: `rds-${dbInstanceClass}-${engine}-${multiAZ ? 'multi' : 'single'}`,
        serviceCode: 'AmazonRDS',
        filters: [
          { Field: 'instanceType', Value: dbInstanceClass },
          { Field: 'databaseEngine', Value: databaseEngine },
          { Field: 'deploymentOption', Value: multiAZ ? 'Multi-AZ' : 'Single-AZ' },
          { Field: 'productFamily', Value: 'Database Instance' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for an ElastiCache node type, resolved on demand
   * like `getEc2InstancePricePerMonth` (same reasoning: node type
   * cardinality too high for prefetch).
   */
  async getElastiCacheNodePricePerMonth(
    region: AwsRegion,
    cacheNodeType: string,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `elasticache-${cacheNodeType}`,
        serviceCode: 'AmazonElastiCache',
        filters: [
          { Field: 'instanceType', Value: cacheNodeType },
          { Field: 'productFamily', Value: 'Cache Instance' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a Redshift node type, resolved on demand
   * like `getEc2InstancePricePerMonth` (cardinality too high for prefetch).
   */
  async getRedshiftNodePricePerMonth(region: AwsRegion, nodeType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `redshift-${nodeType}`,
        serviceCode: 'AmazonRedshift',
        filters: [
          { Field: 'instanceType', Value: nodeType },
          { Field: 'productFamily', Value: 'Compute Instance' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for an OpenSearch/Elasticsearch instance type,
   * resolved on demand. `productFamily` is `'Amazon OpenSearch Service
   * Instance'` (not the older `'ES Instance'` name) as of the
   * Elasticsearch→OpenSearch Service rebrand — verified against a live
   * `GetProducts` call, 2026-07-20.
   */
  async getOpenSearchInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `opensearch-${instanceType}`,
        serviceCode: 'AmazonES',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'productFamily', Value: 'Amazon OpenSearch Service Instance' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /** Monthly on-demand price for an MSK broker instance type, resolved on demand. */
  async getMskBrokerPricePerMonth(region: AwsRegion, brokerInstanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    // MSK broker pricing has no `instanceType`/`productFamily`-per-broker-type
    // attribute to `TERM_MATCH` on at all — the instance type only appears
    // embedded in `usagetype` (e.g. `EUC1-Kafka.t3.small`), and the
    // region-code prefix ("EUC1") rules out an exact TERM_MATCH on the full
    // string. Disambiguated client-side instead — verified against a live
    // `GetProducts` call, 2026-07-20.
    return this.fetchPrice(
      {
        key: `msk-${brokerInstanceType}`,
        serviceCode: 'AmazonMSK',
        filters: [{ Field: 'productFamily', Value: 'Managed Streaming for Apache Kafka (MSK)' }],
        unit: 'hourly',
        matchAttributes: (attrs) =>
          (attrs.usagetype ?? '').toLowerCase().endsWith(brokerInstanceType.toLowerCase()),
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a DocumentDB instance class, resolved on
   * demand. `instanceType` + `productFamily` alone are ambiguous: each
   * instance class has two SKUs (`storageType` `Standard` vs the newer
   * opt-in `I/O-Optimized` tier, ~10% pricier) — verified against a live
   * `GetProducts` call, 2026-07-20. `Standard` matches what a cluster uses
   * unless it explicitly opts into I/O-Optimized storage.
   */
  async getDocDbInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `docdb-${dbInstanceClass}`,
        serviceCode: 'AmazonDocDB',
        filters: [
          { Field: 'instanceType', Value: dbInstanceClass },
          { Field: 'productFamily', Value: 'Database Instance' },
          { Field: 'storageType', Value: 'Standard' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a Neptune instance class, resolved on
   * demand. Same `Standard` vs `I/O Optimized` storage-tier ambiguity as
   * DocumentDB, disambiguated via `volumeType` (Neptune's equivalent
   * attribute name) instead of `storageType` — verified against a live
   * `GetProducts` call, 2026-07-20.
   */
  async getNeptuneInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `neptune-${dbInstanceClass}`,
        serviceCode: 'AmazonNeptune',
        filters: [
          { Field: 'instanceType', Value: dbInstanceClass },
          { Field: 'productFamily', Value: 'Database Instance' },
          { Field: 'volumeType', Value: 'Standard' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for an Amazon MQ broker instance type, resolved
   * on demand. Three corrections needed against the actual Pricing API data
   * (verified via a live `GetProducts` call, 2026-07-20):
   * - `productFamily` is `'Broker Instances'` (plural), not `'Broker
   *   Instance'`.
   * - The Pricing API's `instanceType` attribute has no `mq.` prefix (e.g.
   *   `t3.micro`), while `HostInstanceType` from `DescribeBroker`/
   *   `ListBrokers` does (e.g. `mq.t3.micro`) — the prefix must be stripped
   *   before filtering.
   * - `instanceType` + `productFamily` alone are still ambiguous: each
   *   instance type has a distinct price per `deploymentOption`
   *   (Single-AZ/Multi-AZ) and `brokerEngine` (ActiveMQ/RabbitMQ), so both
   *   must be passed in and filtered on too.
   */
  async getMqBrokerPricePerMonth(
    region: AwsRegion,
    hostInstanceType: string,
    deploymentOption: string,
    brokerEngine: string,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    const instanceType = hostInstanceType.replace(/^mq\./, '');
    return this.fetchPrice(
      {
        key: `mq-${instanceType}-${deploymentOption}-${brokerEngine}`,
        serviceCode: 'AmazonMQ',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'productFamily', Value: 'Broker Instances' },
          { Field: 'deploymentOption', Value: deploymentOption },
          { Field: 'brokerEngine', Value: brokerEngine },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /** Monthly price for a WorkSpaces AlwaysOn bundle compute type, resolved on demand. */
  async getWorkSpacesBundlePricePerMonth(region: AwsRegion, computeTypeName: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `workspaces-${computeTypeName}`,
        serviceCode: 'AmazonWorkSpaces',
        filters: [
          { Field: 'computeType', Value: computeTypeName },
          { Field: 'runningMode', Value: 'AlwaysOn' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a SageMaker notebook instance type, resolved
   * on demand. The `component: 'Notebook Instances'` filter (in addition to
   * `instanceType`) disambiguates from the same instance type billed under
   * Hosting/Training — without it, `AmazonSageMaker`'s `productFamily` alone
   * (`ML Instance`) would match all three and `fetchPrice` would refuse to
   * pick one (safe degrade to no price, never a wrong one).
   */
  async getSageMakerNotebookInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `sagemaker-notebook-${instanceType}`,
        serviceCode: 'AmazonSageMaker',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'component', Value: 'Notebook Instances' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /** Monthly on-demand price for a SageMaker real-time inference (Hosting) instance type, resolved on demand. */
  async getSageMakerEndpointInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.fetchPrice(
      {
        key: `sagemaker-endpoint-${instanceType}`,
        serviceCode: 'AmazonSageMaker',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'component', Value: 'Hosting' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Returns the price for a spec **only if the returned products agree on a
   * single value**. Ambiguous filters (more than one distinct value) ⇒
   * `undefined`, to avoid risking a wrong price (worse than the price list).
   */
  private async fetchPrice(spec: PriceSpec, location: string): Promise<number | undefined> {
    const filters: Filter[] = [
      { Type: 'TERM_MATCH', Field: 'location', Value: location },
      ...spec.filters.map((f) => ({ Type: 'TERM_MATCH' as const, Field: f.Field, Value: f.Value })),
    ];

    const response = await this.client.send(
      new GetProductsCommand({ ServiceCode: spec.serviceCode, Filters: filters, MaxResults: 100 }),
    );

    const distinct = new Set<number>();
    for (const item of response.PriceList ?? []) {
      if (spec.matchAttributes && !spec.matchAttributes(extractProductAttributes(item))) continue;
      for (const usd of extractOnDemandUsd(item)) distinct.add(usd);
    }
    if (distinct.size !== 1) return undefined;

    const [usd] = [...distinct];
    const monthly = spec.unit === 'hourly' ? usd * HOURS_PER_MONTH : usd;
    return +monthly.toFixed(4);
  }
}

/**
 * Parses a PriceList entry into the product object. Entries are usually a
 * JSON string, but the SDK returns them as a boxed `String` (its own
 * lazily-parsed JSON wrapper) rather than a primitive — `typeof` on those is
 * `'object'`, not `'string'`, so a plain `typeof item === 'string'` check
 * misses them and silently drops every price. `instanceof String` catches
 * that case too; already-parsed plain objects fall through unchanged.
 */
function parseProductItem(item: unknown): unknown {
  if (typeof item === 'string' || item instanceof String) {
    try {
      return JSON.parse(item as string);
    } catch {
      return undefined;
    }
  }
  return item;
}

/**
 * Extracts `product.attributes` (e.g. `usagetype`, `instanceType`,
 * `storageType`) from a PriceList entry, for specs whose `matchAttributes`
 * needs to filter on a field the Pricing API doesn't expose as a
 * `TERM_MATCH`-able attribute of its own.
 */
function extractProductAttributes(item: unknown): Record<string, string> {
  const product = parseProductItem(item);
  const attributes = (product as { product?: { attributes?: Record<string, string> } })?.product?.attributes;
  return attributes ?? {};
}

/**
 * Extracts the OnDemand prices (USD, > 0) from a PriceList entry. The entry
 * is a JSON string (or already an object, depending on the SDK version).
 */
export function extractOnDemandUsd(item: unknown): number[] {
  const product = parseProductItem(item);
  const onDemand = (product as { terms?: { OnDemand?: Record<string, unknown> } })?.terms?.OnDemand;
  if (!onDemand || typeof onDemand !== 'object') return [];

  const prices: number[] = [];
  for (const offer of Object.values(onDemand)) {
    const dimensions = (offer as { priceDimensions?: Record<string, unknown> })?.priceDimensions;
    if (!dimensions) continue;
    for (const dimension of Object.values(dimensions)) {
      const usd = (dimension as { pricePerUnit?: { USD?: string } })?.pricePerUnit?.USD;
      const value = usd !== undefined ? Number(usd) : NaN;
      if (Number.isFinite(value) && value > 0) prices.push(value);
    }
  }
  return prices;
}
