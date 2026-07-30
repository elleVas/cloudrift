// SPDX-License-Identifier: Apache-2.0
// Moved to `cloud-cost-pricing` (see ADR-0098): zero dependency on this
// adapter's own AWS-SDK-calling scanners, and the new Terraform
// drift-detector repo needs it too. Re-exported here so existing imports
// keep working unchanged.
export { TablePricingAdapter, mergePriceTables } from 'cloud-cost-pricing';
export type { PriceTable, RegionPrices } from 'cloud-cost-pricing';
