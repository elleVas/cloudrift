// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import type { PricingPort } from 'cloud-cost-domain';
import {
  StaticPriceTableAdapter,
  TablePricingAdapter,
  AwsPricingApiAdapter,
  BUILTIN_PRICE_TABLE,
  BUILTIN_PRICES_AS_OF,
  mergePriceTables,
} from 'cloud-cost-infrastructure-aws-adapter';
import type { PriceTable } from 'cloud-cost-infrastructure-aws-adapter';
import type { AnalysisContext } from './analyze-waste.composition';

export interface BuiltPricing {
  pricing: PricingPort;
  livePricingAdapter?: AwsPricingApiAdapter;
}

/**
 * Layered pricing: static price list (base) ← live AWS Pricing API (--live-pricing)
 * ← user overrides (config.prices, take precedence).
 */
export async function buildPricing(ctx: AnalysisContext): Promise<BuiltPricing> {
  let priceTable: PriceTable = BUILTIN_PRICE_TABLE;
  let pricesAsOf = BUILTIN_PRICES_AS_OF;
  let layered = false;
  // The EC2 underutilized scanner resolves the on-demand per-instance-type price
  // from the same AwsPricingApiAdapter instance: without --live-pricing there is
  // no price per instance type, so the scanner is not registered.
  let livePricingAdapter: AwsPricingApiAdapter | undefined;

  if (ctx.livePricing) {
    ctx.info(chalk.dim('  Fetching current prices from the AWS Pricing API...'));
    livePricingAdapter = new AwsPricingApiAdapter();
    const live = await livePricingAdapter.warmUp(ctx.regions);
    if (live.ok) {
      priceTable = mergePriceTables(priceTable, live.value);
      pricesAsOf = new Date().toISOString().slice(0, 7); // YYYY-MM
      layered = true;
    } else {
      ctx.info(
        chalk.yellow(
          `  Live pricing unavailable (${live.error.message}); using the static price table.`,
        ),
      );
    }
  }

  if (ctx.config.prices) {
    priceTable = mergePriceTables(priceTable, ctx.config.prices);
    pricesAsOf = `${pricesAsOf} + custom overrides`;
    layered = true;
  }

  const pricing: PricingPort = layered
    ? new TablePricingAdapter(priceTable, pricesAsOf)
    : new StaticPriceTableAdapter();

  return { pricing, livePricingAdapter };
}
