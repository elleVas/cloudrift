// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeInstancesCommand,
  type Instance,
  type Reservation,
} from '@aws-sdk/client-ec2';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { UnderutilizedEc2Instance, Ec2UnderutilizedPolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { avgMaxMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_WINDOW_HOURS = 168;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');
/** Estimated saving from downsizing a tier (advisory, to be verified). */
const RIGHTSIZE_SAVING_FRACTION = 0.5;

/**
 * The per-instance-type price is resolved on demand from the Pricing API
 * (the cardinality of instance types is too high for the static price
 * list/the `warmUp` prefetch): `AwsPricingApiAdapter` satisfies this
 * interface via duck typing.
 */
export interface Ec2InstancePricingSource {
  getEc2InstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

type InstanceWithId = Instance & { InstanceId: string };

/**
 * Detects *running* EC2 instances with maximum CPU below a threshold over
 * the entire observation window: likely oversizing. Advisory (optimization
 * category, estimate): low CPU does not guarantee that RAM/network are
 * equally underutilized, it must be verified before a rightsizing. Requires
 * `--live-pricing`: without a price per instance type, no saving can be
 * estimated.
 */
export class AwsEc2UnderutilizedScanner extends CloudWatchIdleScanner<
  EC2Client,
  InstanceWithId,
  { avg: number; max: number },
  UnderutilizedEc2Instance
> {
  readonly kind = 'ec2-underutilized' as const;
  protected readonly serviceLabel = 'EC2';

  constructor(
    private readonly pricing: Ec2InstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<UnderutilizedEc2Instance> = new Ec2UnderutilizedPolicy(),
    windowHours = DEFAULT_WINDOW_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EC2Client {
    return new EC2Client({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: EC2Client): void {
    client.destroy();
  }

  protected async listResources(client: EC2Client): Promise<InstanceWithId[]> {
    const reservations = await paginate<Reservation>(async (cursor) => {
      const r = await client.send(
        new DescribeInstancesCommand({
          Filters: [{ Name: 'instance-state-name', Values: ['running'] }],
          NextToken: cursor,
        }),
      );
      return { items: r.Reservations ?? [], cursor: r.NextToken };
    });
    const rawInstances = reservations.flatMap((r) => r.Instances ?? []);
    const valid = rawInstances.filter((i): i is InstanceWithId => !!i.InstanceId);
    if (valid.length !== rawInstances.length) {
      logger.debug(`${this.kind}: skipped ${rawInstances.length - valid.length} entries missing InstanceId`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, instance: InstanceWithId, window: MetricWindow) {
    return avgMaxMetric(cw, 'AWS/EC2', 'CPUUtilization', [{ Name: 'InstanceId', Value: instance.InstanceId }], window);
  }

  protected override async resolvePrices(raw: InstanceWithId[], region: AwsRegion): Promise<Map<string, number>> {
    const instanceTypes = [...new Set(raw.map((i) => i.InstanceType ?? 'unknown'))];
    const entries = await mapWithConcurrency(instanceTypes, PRICING_CONCURRENCY, async (instanceType) => ({
      instanceType,
      price: (await this.pricing.getEc2InstancePricePerMonth(region, instanceType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceType, e.price]));
  }

  protected toEntity(
    inst: InstanceWithId,
    cpu: { avg: number; max: number },
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): UnderutilizedEc2Instance {
    const instanceType = inst.InstanceType ?? 'unknown';
    const monthlyPrice = prices.get(instanceType) ?? 0;
    return new UnderutilizedEc2Instance({
      instanceId: inst.InstanceId,
      region,
      accountId: this.accountId,
      instanceType,
      avgCpuPercent: cpu.avg,
      maxCpuPercent: cpu.max,
      windowDays: +(this.windowHours / 24).toFixed(1),
      launchTime: inst.LaunchTime ?? new Date(),
      detectedAt: now,
      tags: Object.fromEntries((inst.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: +(monthlyPrice * RIGHTSIZE_SAVING_FRACTION).toFixed(4),
    });
  }
}
