// SPDX-License-Identifier: Apache-2.0
import { PricingClient, GetProductsCommand, type Filter } from '@aws-sdk/client-pricing';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import { AwsAdapterError, createAwsClientConfig, mapWithConcurrency } from 'shared-aws-infra-utils';
import type { AwsRegion } from './aws-region.value-object';
import type { PriceTable, RegionPrices } from './table-pricing.adapter';

/** The Pricing API only lives in some regions; us-east-1 is always valid. */
const PRICING_API_REGION = 'us-east-1';
/** AWS convention for converting hourly prices into monthly ones. */
const HOURS_PER_MONTH = 730;
/** Concurrent Pricing calls per region (the API has low rate limits). */
const PRICING_CONCURRENCY = 5;

/**
 * Maps region code → human-readable "location" used by the Pricing API.
 * Regions not present are left to the static price list. Exported so a
 * consumer building its own on-demand (non-`warmUp`) Pricing API queries —
 * e.g. cloudrift core's per-instance-type lookups — can reuse the same
 * mapping via `fetchPrice` instead of duplicating it.
 */
export const REGION_TO_LOCATION: Record<string, string> = {
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

export type PriceUnit = 'gb-month' | 'hourly';

export interface PriceSpec {
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
 * Price specs prefetched by `warmUp`. Each entry maps a PriceTable key to an
 * AWS product via ServiceCode + filters. Only low-cardinality, fixed-SKU
 * kinds belong here — anything keyed by instance type/class (EC2, RDS,
 * ElastiCache, ...) has too high a cardinality to prefetch and is resolved
 * on demand instead, outside this adapter (see `fetchPrice`).
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
 * user's overrides (see ADR-0009 in cloudrift core).
 *
 * Deliberately minimal: this class only carries `warmUp` (the low-cardinality
 * prefetch) and the generic `fetchPrice` primitive it's built on — not the
 * ~13 per-instance-type on-demand lookups (EC2/RDS/ElastiCache/...) that
 * cloudrift core's own scanners need. Those stay in core's own adapter,
 * composing an instance of this class for `warmUp`/`fetchPrice` rather than
 * duplicating this logic — see ADR-0037 in cloudrift-iac-detector for why
 * only this slice is shared.
 */
export class AwsPricingApiAdapter {
  constructor(
    credentials?: AwsCredentialIdentityProvider,
    private readonly client = new PricingClient({
      ...createAwsClientConfig(credentials),
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
      return Result.fail(new AwsAdapterError('Pricing', err));
    }
  }

  /** Release the underlying HTTP connection pool. Call once after all scans complete. */
  dispose(): void {
    this.client.destroy();
  }

  /**
   * Returns the price for a spec **only if the returned products agree on a
   * single value**. Ambiguous filters (more than one distinct value) ⇒
   * `undefined`, to avoid risking a wrong price (worse than the price list).
   * Public so a consumer's own on-demand (per-instance-type) queries can
   * reuse this primitive instead of reimplementing it.
   */
  async fetchPrice(spec: PriceSpec, location: string): Promise<number | undefined> {
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
