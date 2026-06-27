// SPDX-License-Identifier: Apache-2.0
import type { PricingPort, AwsRegion } from 'cloud-cost-domain';

/** Prices for a single region: key (e.g. "ebs-gp3", "nat-gateway") → USD. */
export type RegionPrices = Record<string, number>;

/**
 * Price table: `region → prices`, with a special `default` key used as a
 * fallback for regions not listed. It's the shared shape used by all price
 * sources (static price list, AWS Pricing API, user overrides), so the
 * sources can be composed with a simple merge.
 */
export type PriceTable = Record<string, RegionPrices>;

/**
 * Merges two price tables at the (region, key) level: `overlay` values win
 * over `base` ones. Used to layer the sources: static (base) ← live API ←
 * user override (wins).
 */
export function mergePriceTables(base: PriceTable, overlay: PriceTable): PriceTable {
  const result: PriceTable = {};
  for (const region of new Set([...Object.keys(base), ...Object.keys(overlay)])) {
    result[region] = { ...base[region], ...overlay[region] };
  }
  return result;
}

/**
 * Pricing adapter that reads from an in-memory `PriceTable`. The getters are
 * synchronous: any asynchronous source (AWS Pricing API) must first
 * materialize its own table, then compose it here.
 */
export class TablePricingAdapter implements PricingPort {
  constructor(
    private readonly table: PriceTable,
    private readonly pricesAsOf: string,
  ) {}

  private lookup(region: AwsRegion, key: string): number | undefined {
    return this.table[region.code]?.[key] ?? this.table.default?.[key];
  }

  getEbsVolumePricePerGbMonth(region: AwsRegion, volumeType: string): number {
    return this.lookup(region, `ebs-${volumeType}`) ?? this.table.default?.['ebs-gp3'] ?? 0;
  }

  getEbsSnapshotPricePerGbMonth(region: AwsRegion): number {
    return this.lookup(region, 'ebs-snapshot') ?? 0;
  }

  getElasticIpPricePerMonth(region: AwsRegion): number {
    return this.lookup(region, 'elastic-ip') ?? 0;
  }

  getRdsStoragePricePerGbMonth(region: AwsRegion, storageType: string): number {
    return this.lookup(region, `rds-${storageType}`) ?? this.table.default?.['rds-gp2'] ?? 0;
  }

  getLoadBalancerPricePerMonth(region: AwsRegion): number {
    return this.lookup(region, 'load-balancer') ?? 0;
  }

  getNatGatewayPricePerMonth(region: AwsRegion): number {
    return this.lookup(region, 'nat-gateway') ?? 0;
  }

  getLogGroupPricePerGbMonth(region: AwsRegion): number {
    return this.lookup(region, 'cw-logs') ?? 0;
  }

  getS3StandardPricePerGbMonth(region: AwsRegion): number {
    return this.lookup(region, 's3-standard') ?? 0;
  }

  getEfsStandardPricePerGbMonth(region: AwsRegion): number {
    return this.lookup(region, 'efs-standard') ?? 0;
  }

  getDynamoDbRcuPricePerHour(region: AwsRegion): number {
    return this.lookup(region, 'dynamodb-rcu') ?? 0;
  }

  getDynamoDbWcuPricePerHour(region: AwsRegion): number {
    return this.lookup(region, 'dynamodb-wcu') ?? 0;
  }

  getFsxStoragePricePerGbMonth(region: AwsRegion, fileSystemType: string): number {
    return this.lookup(region, `fsx-${fileSystemType.toLowerCase()}`) ?? this.table.default?.['fsx-windows'] ?? 0;
  }

  getVpnConnectionPricePerMonth(region: AwsRegion): number {
    return this.lookup(region, 'vpn-connection') ?? 0;
  }

  getTransitGatewayAttachmentPricePerMonth(region: AwsRegion): number {
    return this.lookup(region, 'transit-gateway-attachment') ?? 0;
  }

  getKinesisShardPricePerMonth(region: AwsRegion): number {
    return this.lookup(region, 'kinesis-shard') ?? 0;
  }

  getPricesAsOf(): string {
    return this.pricesAsOf;
  }
}
