import {
  PricingClient,
  GetProductsCommand,
  type Filter,
} from '@aws-sdk/client-pricing';
import { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import type { PriceTable, RegionPrices } from './table-pricing.adapter';

/** Il Pricing API risiede solo in alcune regioni; us-east-1 è sempre valida. */
const PRICING_API_REGION = 'us-east-1';
/** Convenzione AWS per convertire i prezzi orari in mensili. */
const HOURS_PER_MONTH = 730;
/** Chiamate Pricing simultanee per regione (l'API ha rate limit bassi). */
const PRICING_CONCURRENCY = 5;

/**
 * Mappa codice regione → "location" leggibile usata dal Pricing API.
 * Le regioni non presenti vengono lasciate al listino statico.
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
 * Mappa engine RDS (valore di `DescribeDBInstances`) → `databaseEngine` del
 * Pricing API. Engine assenti (es. varianti Aurora) restituiscono `undefined`
 * da `getRdsInstancePricePerMonth`: meglio nessun prezzo che uno sbagliato.
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
  /** Chiave nella PriceTable (deve combaciare con quelle di prices.json). */
  key: string;
  serviceCode: string;
  /** Filtri TERM_MATCH oltre a `location` (aggiunto automaticamente). */
  filters: Array<{ Field: string; Value: string }>;
  unit: PriceUnit;
}

/**
 * Specifiche di prezzo recuperate dal Pricing API. Ogni voce mappa una chiave
 * della PriceTable a un prodotto AWS tramite ServiceCode + filtri. La routine
 * di fetch è generica e accetta un prezzo solo se i filtri identificano un
 * unico valore (vedi `fetchPrice`): filtri ambigui ⇒ fallback allo statico.
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
];

/**
 * Adapter che recupera i prezzi dall'AWS Pricing API. Non implementa
 * direttamente `PricingPort`: produce una `PriceTable` via `warmUp` che il
 * composition root fonde con il listino statico e gli override dell'utente.
 */
export class AwsPricingApiAdapter {
  constructor(
    private readonly client = new PricingClient({ region: PRICING_API_REGION }),
  ) {}

  /**
   * Recupera i prezzi per le regioni richieste e ne costruisce una PriceTable.
   * Una chiave assente (regione sconosciuta, filtro ambiguo, prodotto non
   * trovato) viene semplicemente omessa: il merge la lascia allo statico.
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
    } finally {
      this.client.destroy();
    }
  }

  /**
   * Prezzo on-demand mensile per un singolo instance type, risolto on-demand
   * (non rientra in `warmUp`/`PRICE_SPECS`: la cardinalità degli instance
   * type è troppo alta per un prefetch). Va chiamato solo per i type
   * effettivamente osservati durante uno scan.
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
   * Prezzo on-demand mensile per una classe di istanza RDS, risolto on-demand
   * come `getEc2InstancePricePerMonth` (stessa motivazione: cardinalità
   * troppo alta per il prefetch). Richiede una mappatura engine → engine del
   * Pricing API (vedi `RDS_ENGINE_TO_PRICING_ENGINE`): engine non mappati
   * (es. Aurora) restituiscono `undefined`.
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
   * Prezzo on-demand mensile per un node type ElastiCache, risolto on-demand
   * come `getEc2InstancePricePerMonth` (stessa motivazione: cardinalità dei
   * node type troppo alta per il prefetch).
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
   * Restituisce il prezzo per una spec **solo se i prodotti restituiti
   * concordano su un unico valore**. Filtri ambigui (più valori distinti) ⇒
   * `undefined`, per non rischiare un prezzo sbagliato (peggio del listino).
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
      for (const usd of extractOnDemandUsd(item)) distinct.add(usd);
    }
    if (distinct.size !== 1) return undefined;

    const [usd] = [...distinct];
    const monthly = spec.unit === 'hourly' ? usd * HOURS_PER_MONTH : usd;
    return +monthly.toFixed(4);
  }
}

/**
 * Estrae i prezzi OnDemand (USD, > 0) da una voce PriceList. La voce è una
 * stringa JSON (o già un oggetto, a seconda della versione SDK).
 */
export function extractOnDemandUsd(item: unknown): number[] {
  let product: unknown;
  if (typeof item === 'string') {
    try {
      product = JSON.parse(item);
    } catch {
      return [];
    }
  } else {
    product = item;
  }

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
