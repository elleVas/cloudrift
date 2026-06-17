import type { PricingPort, AwsRegion } from 'cloud-cost-domain';

/** Prezzi di una singola regione: chiave (es. "ebs-gp3", "nat-gateway") → USD. */
export type RegionPrices = Record<string, number>;

/**
 * Tabella prezzi: `regione → prezzi`, con una chiave speciale `default` usata
 * come fallback per le regioni non elencate. È la forma condivisa da tutte le
 * fonti di prezzo (listino statico, AWS Pricing API, override dell'utente),
 * così le sorgenti si compongono con un semplice merge.
 */
export type PriceTable = Record<string, RegionPrices>;

/**
 * Fonde due tabelle prezzi a livello di (regione, chiave): i valori di
 * `overlay` vincono su quelli di `base`. Usato per stratificare le fonti:
 * statico (base) ← live API ← override dell'utente (vince).
 */
export function mergePriceTables(base: PriceTable, overlay: PriceTable): PriceTable {
  const result: PriceTable = {};
  for (const region of new Set([...Object.keys(base), ...Object.keys(overlay)])) {
    result[region] = { ...base[region], ...overlay[region] };
  }
  return result;
}

/**
 * Adapter di pricing che legge da una `PriceTable` in memoria. I getter sono
 * sincroni: qualunque fonte asincrona (AWS Pricing API) deve prima
 * materializzare la propria tabella, poi comporla qui.
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

  getPricesAsOf(): string {
    return this.pricesAsOf;
  }
}
