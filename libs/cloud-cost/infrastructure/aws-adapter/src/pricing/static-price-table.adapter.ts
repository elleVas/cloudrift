import priceTable from './prices.json';
import {
  TablePricingAdapter,
  type PriceTable,
  type RegionPrices,
} from './table-pricing.adapter';

/**
 * La tabella prezzi built-in, estratta da `prices.json` scartando i campi di
 * metadati (`_comment`, `pricesAsOf`) e tenendo solo le tabelle per regione.
 * Esportata per poterla comporre con le altre fonti (live API, override utente).
 */
export const BUILTIN_PRICE_TABLE: PriceTable = Object.fromEntries(
  Object.entries(priceTable as Record<string, unknown>).filter(
    ([, value]) => typeof value === 'object' && value !== null,
  ) as Array<[string, RegionPrices]>,
);

/** Data (YYYY-MM) di ultima verifica del listino built-in. */
export const BUILTIN_PRICES_AS_OF: string = priceTable.pricesAsOf;

/**
 * Adapter di pricing basato sul listino statico `prices.json`. È il fallback
 * sempre disponibile quando non sono configurati prezzi live o manuali.
 */
export class StaticPriceTableAdapter extends TablePricingAdapter {
  constructor() {
    super(BUILTIN_PRICE_TABLE, BUILTIN_PRICES_AS_OF);
  }
}
