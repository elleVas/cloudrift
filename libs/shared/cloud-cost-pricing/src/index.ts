// SPDX-License-Identifier: Apache-2.0
export { AwsRegion, InvalidAwsRegionError, AWS_REGION_CODES } from './aws-region.value-object';
export { CostEstimate } from './cost-estimate.value-object';
export type { PricingPort } from './pricing.port';
export {
  WastePolicy,
  waste,
  notWaste,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_IGNORE_TAG,
} from './waste-policy';
export type { TaggedResource, WasteVerdict, WastePolicyOptions } from './waste-policy';
export { TablePricingAdapter, mergePriceTables } from './table-pricing.adapter';
export type { PriceTable, RegionPrices } from './table-pricing.adapter';
export { StaticPriceTableAdapter, BUILTIN_PRICE_TABLE, BUILTIN_PRICES_AS_OF } from './static-price-table.adapter';
