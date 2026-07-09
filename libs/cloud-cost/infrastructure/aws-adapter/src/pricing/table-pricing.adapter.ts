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

  getPrice(region: AwsRegion, key: string): number {
    return this.table[region.code]?.[key] ?? this.table.default?.[key] ?? 0;
  }

  getPricesAsOf(): string {
    return this.pricesAsOf;
  }
}
