// SPDX-License-Identifier: Apache-2.0
import priceTable from './prices.json';
import {
  TablePricingAdapter,
  type PriceTable,
  type RegionPrices,
} from './table-pricing.adapter';

/**
 * The built-in price table, extracted from `prices.json` by discarding the
 * metadata fields (`_comment`, `pricesAsOf`) and keeping only the per-region
 * tables. Exported so it can be composed with other sources (live API, user
 * overrides).
 */
export const BUILTIN_PRICE_TABLE: PriceTable = Object.fromEntries(
  Object.entries(priceTable as Record<string, unknown>).filter(
    ([, value]) => typeof value === 'object' && value !== null,
  ) as Array<[string, RegionPrices]>,
);

/** Date (YYYY-MM) the built-in price list was last verified. */
export const BUILTIN_PRICES_AS_OF: string = priceTable.pricesAsOf;

/**
 * Pricing adapter based on the static `prices.json` price list. It is the
 * always-available fallback when no live or manual prices are configured.
 */
export class StaticPriceTableAdapter extends TablePricingAdapter {
  constructor() {
    super(BUILTIN_PRICE_TABLE, BUILTIN_PRICES_AS_OF);
  }
}
