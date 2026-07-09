// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeNatGatewaysCommand,
  type NatGateway as AwsNatGateway,
} from '@aws-sdk/client-ec2';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { NatGateway, NatGatewayWastePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { AWS_CLIENT_DEFAULTS } from '../utils/client-config';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const logger = createLogger('cloudrift:scanner');

/** A gateway with the ID guaranteed present: AWS always returns it, but the SDK type marks it optional. */
type NatGatewayWithId = AwsNatGateway & { NatGatewayId: string };

export class AwsNatGatewayScanner extends CloudWatchIdleScanner<EC2Client, NatGatewayWithId, number, NatGateway> {
  readonly kind = 'nat-gateway' as const;
  protected readonly serviceLabel = 'NAT';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<NatGateway> = new NatGatewayWastePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EC2Client {
    return new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
  }

  protected destroyPrimaryClient(client: EC2Client): void {
    client.destroy();
  }

  protected async listResources(client: EC2Client): Promise<NatGatewayWithId[]> {
    const gateways = await paginate<AwsNatGateway>(async (cursor) => {
      const r = await client.send(
        new DescribeNatGatewaysCommand({
          Filter: [{ Name: 'state', Values: ['available'] }],
          NextToken: cursor,
        }),
      );
      return { items: r.NatGateways ?? [], cursor: r.NextToken };
    });
    const valid = gateways.filter((gw): gw is NatGatewayWithId => !!gw.NatGatewayId);
    if (valid.length !== gateways.length) {
      logger.debug(`${this.kind}: skipped ${gateways.length - valid.length} entries missing NatGatewayId`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, gw: NatGatewayWithId, window: MetricWindow) {
    return sumMetric(
      cw,
      'AWS/NATGateway',
      'BytesOutToDestination',
      [{ Name: 'NatGatewayId', Value: gw.NatGatewayId }],
      window,
    );
  }

  protected toEntity(gw: NatGatewayWithId, bytesOutLastWindow: number, _prices: Map<string, number>, region: AwsRegion, now: Date): NatGateway {
    return new NatGateway({
      natGatewayId: gw.NatGatewayId,
      region,
      accountId: this.accountId,
      vpcId: gw.VpcId ?? 'unknown',
      createTime: gw.CreateTime ?? new Date(0),
      detectedAt: now,
      bytesOutLastWindow,
      metricWindowHours: this.windowHours,
      tags: Object.fromEntries((gw.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: this.pricing.getPrice(region, 'nat-gateway'),
    });
  }
}
