// SPDX-License-Identifier: Apache-2.0
import { MqClient, ListBrokersCommand, type BrokerSummary } from '@aws-sdk/client-mq';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { MqBroker, MqIdleBrokerPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface MqBrokerPricingSource {
  getMqBrokerPricePerMonth(
    region: AwsRegion,
    hostInstanceType: string,
    deploymentOption: string,
    brokerEngine: string,
  ): Promise<number | undefined>;
}

type BrokerWithId = BrokerSummary & { BrokerId: string };

interface MqPriceSpec {
  hostInstanceType: string;
  /** Pricing API `deploymentOption` attribute value (`Single-AZ`/`Multi-AZ`). */
  deploymentOption: string;
  /** Pricing API `brokerEngine` attribute value (`ActiveMQ`/`RabbitMQ`). */
  brokerEngine: string;
}

function priceSpecKey(spec: MqPriceSpec): string {
  return `${spec.hostInstanceType}::${spec.deploymentOption}::${spec.brokerEngine}`;
}

/** Amazon MQ's `DeploymentMode` has three values; the Pricing API only distinguishes Single-AZ vs Multi-AZ (`CLUSTER_MULTI_AZ` — RabbitMQ only — prices as Multi-AZ too). */
function toDeploymentOption(deploymentMode: string): string {
  return deploymentMode === 'SINGLE_INSTANCE' ? 'Single-AZ' : 'Multi-AZ';
}

function toBrokerEngine(engineType: string): string {
  return engineType === 'RABBITMQ' ? 'RabbitMQ' : 'ActiveMQ';
}

function priceSpecOf(broker: BrokerWithId): MqPriceSpec {
  return {
    hostInstanceType: broker.HostInstanceType ?? 'unknown',
    deploymentOption: toDeploymentOption(broker.DeploymentMode ?? 'SINGLE_INSTANCE'),
    brokerEngine: toBrokerEngine(broker.EngineType ?? 'ACTIVEMQ'),
  };
}

export class AwsMqIdleScanner extends CloudWatchIdleScanner<MqClient, BrokerWithId, number, MqBroker> {
  readonly kind = 'mq-idle-broker' as const;
  protected readonly serviceLabel = 'MQ';

  constructor(
    private readonly pricing: MqBrokerPricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<MqBroker> = new MqIdleBrokerPolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): MqClient {
    return new MqClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: MqClient): void {
    client.destroy();
  }

  protected async listResources(client: MqClient): Promise<BrokerWithId[]> {
    const brokers = await paginate<BrokerSummary>(async (cursor) => {
      const r = await client.send(new ListBrokersCommand({ NextToken: cursor }));
      return { items: r.BrokerSummaries ?? [], cursor: r.NextToken };
    });
    const valid = brokers.filter((b): b is BrokerWithId => !!b.BrokerId);
    if (valid.length !== brokers.length) {
      logger.debug(`${this.kind}: skipped ${brokers.length - valid.length} entries missing BrokerId`);
    }
    return valid.filter((b) => b.BrokerState === 'RUNNING');
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, broker: BrokerWithId, window: MetricWindow) {
    return sumMetric(cw, 'AWS/AmazonMQ', 'NetworkIn', [{ Name: 'Broker', Value: broker.BrokerId }], window);
  }

  protected override async resolvePrices(raw: BrokerWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const uniqueSpecs = [...new Map(raw.map((b) => [priceSpecKey(priceSpecOf(b)), priceSpecOf(b)])).values()];
    const entries = await mapWithConcurrency(uniqueSpecs, PRICING_CONCURRENCY, async (spec) => ({
      key: priceSpecKey(spec),
      price:
        (await this.pricing.getMqBrokerPricePerMonth(
          region,
          spec.hostInstanceType,
          spec.deploymentOption,
          spec.brokerEngine,
        )) ?? 0,
    }));
    return new Map(entries.map((e) => [e.key, e.price]));
  }

  protected toEntity(
    broker: BrokerWithId,
    networkBytesLastWindow: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): MqBroker {
    const hostInstanceType = broker.HostInstanceType ?? 'unknown';
    const deploymentMode = broker.DeploymentMode ?? 'SINGLE_INSTANCE';
    const brokerCount = deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ' ? 2 : 1;
    const monthlyPrice = (prices.get(priceSpecKey(priceSpecOf(broker))) ?? 0) * brokerCount;
    return new MqBroker({
      brokerId: broker.BrokerId,
      brokerName: broker.BrokerName ?? broker.BrokerId,
      region,
      accountId: this.accountId,
      hostInstanceType,
      deploymentMode,
      networkBytesLastWindow,
      metricWindowHours: this.windowHours,
      created: broker.Created ?? new Date(0),
      detectedAt: now,
      tags: {},
      monthlyCostUsd: +monthlyPrice.toFixed(4),
    });
  }
}
