// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVpnConnectionsCommand, type VpnConnection as SdkVpnConnection } from '@aws-sdk/client-ec2';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort } from 'cloud-cost-domain';
import { VpnConnection, VpnConnectionIdlePolicy, type WastePolicy } from 'cloud-cost-domain';
import { createAwsClientConfig } from '../utils/client-config';
import { sumMetrics, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 48;
const logger = createLogger('cloudrift:scanner');

type VpnConnectionWithId = SdkVpnConnection & { VpnConnectionId: string };

/**
 * Detects Site-to-Site VPN connections with zero tunnel traffic in the
 * observed window. Billed per connection-hour regardless of traffic, with a
 * single flat rate (no per-type cardinality), so pricing is always-on
 * (ADR-0037), like NAT Gateway.
 */
export class AwsVpnConnectionIdleScanner extends CloudWatchIdleScanner<EC2Client, VpnConnectionWithId, number, VpnConnection> {
  readonly kind = 'vpn-connection-idle' as const;
  protected readonly serviceLabel = 'VPN';

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    policy: WastePolicy<VpnConnection> = new VpnConnectionIdlePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): EC2Client {
    return new EC2Client({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: EC2Client): void {
    client.destroy();
  }

  protected async listResources(client: EC2Client): Promise<VpnConnectionWithId[]> {
    const r = await client.send(
      new DescribeVpnConnectionsCommand({ Filters: [{ Name: 'state', Values: ['available'] }] }),
    );
    const connections = r.VpnConnections ?? [];
    const valid = connections.filter((c): c is VpnConnectionWithId => !!c.VpnConnectionId);
    if (valid.length !== connections.length) {
      logger.debug(`${this.kind}: skipped ${connections.length - valid.length} entries missing VpnConnectionId`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, region: AwsRegion, c: VpnConnectionWithId, window: MetricWindow) {
    return sumMetrics(
      cw,
      'AWS/VPN',
      ['TunnelDataIn', 'TunnelDataOut'],
      [{ Name: 'VpnId', Value: c.VpnConnectionId }],
      window,
    );
  }

  protected toEntity(
    c: VpnConnectionWithId,
    tunnelBytesLastWindow: number,
    _prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): VpnConnection {
    return new VpnConnection({
      vpnConnectionId: c.VpnConnectionId,
      region,
      accountId: this.accountId,
      vpnGatewayId: c.VpnGatewayId,
      transitGatewayId: c.TransitGatewayId,
      tunnelBytesLastWindow,
      metricWindowHours: this.windowHours,
      detectedAt: now,
      tags: Object.fromEntries((c.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
      monthlyCostUsd: this.pricing.getPrice(region, 'vpn-connection'),
    });
  }
}
