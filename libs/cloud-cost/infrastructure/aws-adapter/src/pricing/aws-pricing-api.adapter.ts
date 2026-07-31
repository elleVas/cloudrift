// SPDX-License-Identifier: Apache-2.0
import { PricingClient } from '@aws-sdk/client-pricing';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { createAwsClientConfig } from 'shared-aws-infra-utils';
import { AwsPricingApiAdapter as SharedAwsPricingApiAdapter, REGION_TO_LOCATION } from 'cloud-cost-pricing';
import type { PriceTable } from './table-pricing.adapter';

/** The Pricing API only lives in some regions; us-east-1 is always valid. */
const PRICING_API_REGION = 'us-east-1';

/**
 * Maps RDS engine (value from `DescribeDBInstances`) → Pricing API
 * `databaseEngine`. Missing engines (e.g. Aurora variants) cause
 * `getRdsInstancePricePerMonth` to return `undefined`: better no price than
 * a wrong one.
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

/**
 * Adapter for the ~13 per-instance-type/class Pricing API lookups only
 * core's own underutilized-resource scanners need (too high a cardinality
 * to prefetch in `warmUp`/`prices.json`). `warmUp` itself and the generic
 * `fetchPrice`/`REGION_TO_LOCATION` primitives it's built on now live in the
 * shared `cloud-cost-pricing` package (see ADR-0037 in
 * cloudrift-iac-detector) — this class composes an instance of that shared
 * adapter rather than duplicating them, sharing the same underlying
 * `PricingClient`/connection pool.
 */
export class AwsPricingApiAdapter {
  private readonly client: PricingClient;
  private readonly warmUpAdapter: SharedAwsPricingApiAdapter;

  constructor(
    credentials?: AwsCredentialIdentityProvider,
    client: PricingClient = new PricingClient({
      ...createAwsClientConfig(credentials),
      region: PRICING_API_REGION,
    }),
  ) {
    this.client = client;
    this.warmUpAdapter = new SharedAwsPricingApiAdapter(credentials, client);
  }

  /**
   * Fetches prices for the requested regions and builds a PriceTable from
   * them. A missing key (unknown region, ambiguous filter, product not
   * found) is simply omitted: the merge leaves it to the static list.
   */
  async warmUp(regions: readonly AwsRegion[]): Promise<Result<PriceTable>> {
    return this.warmUpAdapter.warmUp(regions);
  }

  /** Release the underlying HTTP connection pool. Call once after all scans complete. */
  dispose(): void {
    this.client.destroy();
  }

  /**
   * Monthly on-demand price for a single instance type, resolved on demand
   * (not part of `warmUp`/`PRICE_SPECS`: the cardinality of instance types
   * is too high for a prefetch). Should only be called for the types
   * actually observed during a scan.
   */
  async getEc2InstancePricePerMonth(
    region: AwsRegion,
    instanceType: string,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
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
   * Monthly on-demand price for an RDS instance class, resolved on demand
   * like `getEc2InstancePricePerMonth` (same reasoning: cardinality too high
   * for prefetch). Requires an engine → Pricing API engine mapping (see
   * `RDS_ENGINE_TO_PRICING_ENGINE`): unmapped engines (e.g. Aurora) return
   * `undefined`.
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
    return this.warmUpAdapter.fetchPrice(
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
   * Monthly on-demand price for an ElastiCache node type, resolved on demand
   * like `getEc2InstancePricePerMonth` (same reasoning: node type
   * cardinality too high for prefetch).
   */
  async getElastiCacheNodePricePerMonth(
    region: AwsRegion,
    cacheNodeType: string,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
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
   * Monthly on-demand price for a Redshift node type, resolved on demand
   * like `getEc2InstancePricePerMonth` (cardinality too high for prefetch).
   */
  async getRedshiftNodePricePerMonth(region: AwsRegion, nodeType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `redshift-${nodeType}`,
        serviceCode: 'AmazonRedshift',
        filters: [
          { Field: 'instanceType', Value: nodeType },
          { Field: 'productFamily', Value: 'Compute Instance' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for an OpenSearch/Elasticsearch instance type,
   * resolved on demand. `productFamily` is `'Amazon OpenSearch Service
   * Instance'` (not the older `'ES Instance'` name) as of the
   * Elasticsearch→OpenSearch Service rebrand — verified against a live
   * `GetProducts` call, 2026-07-20.
   */
  async getOpenSearchInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `opensearch-${instanceType}`,
        serviceCode: 'AmazonES',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'productFamily', Value: 'Amazon OpenSearch Service Instance' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /** Monthly on-demand price for an MSK broker instance type, resolved on demand. */
  async getMskBrokerPricePerMonth(region: AwsRegion, brokerInstanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    // MSK broker pricing has no `instanceType`/`productFamily`-per-broker-type
    // attribute to `TERM_MATCH` on at all — the instance type only appears
    // embedded in `usagetype` (e.g. `EUC1-Kafka.t3.small`), and the
    // region-code prefix ("EUC1") rules out an exact TERM_MATCH on the full
    // string. Disambiguated client-side instead — verified against a live
    // `GetProducts` call, 2026-07-20.
    return this.warmUpAdapter.fetchPrice(
      {
        key: `msk-${brokerInstanceType}`,
        serviceCode: 'AmazonMSK',
        filters: [{ Field: 'productFamily', Value: 'Managed Streaming for Apache Kafka (MSK)' }],
        unit: 'hourly',
        matchAttributes: (attrs) =>
          (attrs.usagetype ?? '').toLowerCase().endsWith(brokerInstanceType.toLowerCase()),
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a DocumentDB instance class, resolved on
   * demand. `instanceType` + `productFamily` alone are ambiguous: each
   * instance class has two SKUs (`storageType` `Standard` vs the newer
   * opt-in `I/O-Optimized` tier, ~10% pricier) — verified against a live
   * `GetProducts` call, 2026-07-20. `Standard` matches what a cluster uses
   * unless it explicitly opts into I/O-Optimized storage.
   */
  async getDocDbInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `docdb-${dbInstanceClass}`,
        serviceCode: 'AmazonDocDB',
        filters: [
          { Field: 'instanceType', Value: dbInstanceClass },
          { Field: 'productFamily', Value: 'Database Instance' },
          { Field: 'storageType', Value: 'Standard' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a Neptune instance class, resolved on
   * demand. Same `Standard` vs `I/O Optimized` storage-tier ambiguity as
   * DocumentDB, disambiguated via `volumeType` (Neptune's equivalent
   * attribute name) instead of `storageType` — verified against a live
   * `GetProducts` call, 2026-07-20.
   */
  async getNeptuneInstancePricePerMonth(region: AwsRegion, dbInstanceClass: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `neptune-${dbInstanceClass}`,
        serviceCode: 'AmazonNeptune',
        filters: [
          { Field: 'instanceType', Value: dbInstanceClass },
          { Field: 'productFamily', Value: 'Database Instance' },
          { Field: 'volumeType', Value: 'Standard' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for an Amazon MQ broker instance type, resolved
   * on demand. Three corrections needed against the actual Pricing API data
   * (verified via a live `GetProducts` call, 2026-07-20):
   * - `productFamily` is `'Broker Instances'` (plural), not `'Broker
   *   Instance'`.
   * - The Pricing API's `instanceType` attribute has no `mq.` prefix (e.g.
   *   `t3.micro`), while `HostInstanceType` from `DescribeBroker`/
   *   `ListBrokers` does (e.g. `mq.t3.micro`) — the prefix must be stripped
   *   before filtering.
   * - `instanceType` + `productFamily` alone are still ambiguous: each
   *   instance type has a distinct price per `deploymentOption`
   *   (Single-AZ/Multi-AZ) and `brokerEngine` (ActiveMQ/RabbitMQ), so both
   *   must be passed in and filtered on too.
   */
  async getMqBrokerPricePerMonth(
    region: AwsRegion,
    hostInstanceType: string,
    deploymentOption: string,
    brokerEngine: string,
  ): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    const instanceType = hostInstanceType.replace(/^mq\./, '');
    return this.warmUpAdapter.fetchPrice(
      {
        key: `mq-${instanceType}-${deploymentOption}-${brokerEngine}`,
        serviceCode: 'AmazonMQ',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'productFamily', Value: 'Broker Instances' },
          { Field: 'deploymentOption', Value: deploymentOption },
          { Field: 'brokerEngine', Value: brokerEngine },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /** Monthly price for a WorkSpaces AlwaysOn bundle compute type, resolved on demand. */
  async getWorkSpacesBundlePricePerMonth(region: AwsRegion, computeTypeName: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `workspaces-${computeTypeName}`,
        serviceCode: 'AmazonWorkSpaces',
        filters: [
          { Field: 'computeType', Value: computeTypeName },
          { Field: 'runningMode', Value: 'AlwaysOn' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /**
   * Monthly on-demand price for a SageMaker notebook instance type, resolved
   * on demand. The `component: 'Notebook Instances'` filter (in addition to
   * `instanceType`) disambiguates from the same instance type billed under
   * Hosting/Training — without it, `AmazonSageMaker`'s `productFamily` alone
   * (`ML Instance`) would match all three and `fetchPrice` would refuse to
   * pick one (safe degrade to no price, never a wrong one).
   */
  async getSageMakerNotebookInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `sagemaker-notebook-${instanceType}`,
        serviceCode: 'AmazonSageMaker',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'component', Value: 'Notebook Instances' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

  /** Monthly on-demand price for a SageMaker real-time inference (Hosting) instance type, resolved on demand. */
  async getSageMakerEndpointInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined> {
    const location = REGION_TO_LOCATION[region.code];
    if (!location) return undefined;
    return this.warmUpAdapter.fetchPrice(
      {
        key: `sagemaker-endpoint-${instanceType}`,
        serviceCode: 'AmazonSageMaker',
        filters: [
          { Field: 'instanceType', Value: instanceType },
          { Field: 'component', Value: 'Hosting' },
        ],
        unit: 'hourly',
      },
      location,
    );
  }

}
