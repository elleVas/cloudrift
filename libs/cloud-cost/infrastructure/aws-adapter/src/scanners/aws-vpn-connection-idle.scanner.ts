// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVpnConnectionsCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { VpnConnection, VpnConnectionIdlePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_LOOKBACK_HOURS = 48;
const CLOUDWATCH_CONCURRENCY = 5;

/**
 * Detects Site-to-Site VPN connections with zero tunnel traffic in the
 * observed window. Billed per connection-hour regardless of traffic, with a
 * single flat rate (no per-type cardinality), so pricing is always-on
 * (ADR-0037), like NAT Gateway.
 */
export class AwsVpnConnectionIdleScanner implements WasteScannerPort {
  readonly kind = 'vpn-connection-idle' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new VpnConnectionIdlePolicy(),
    private readonly windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const ec2 = new EC2Client({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const r = await ec2.send(
        new DescribeVpnConnectionsCommand({ Filters: [{ Name: 'state', Values: ['available'] }] }),
      );
      const connections = r.VpnConnections ?? [];
      if (connections.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const tunnelBytes = await mapWithConcurrency(connections, CLOUDWATCH_CONCURRENCY, (c) =>
        this.sumTunnelBytes(cw, c.VpnConnectionId!, startTime, endTime, periodSeconds),
      );

      const monthlyCostUsd = this.pricing.getVpnConnectionPricePerMonth(region);
      const now = new Date();
      const idle = connections
        .map(
          (c, index) =>
            new VpnConnection({
              vpnConnectionId: c.VpnConnectionId!,
              region,
              accountId: this.accountId,
              vpnGatewayId: c.VpnGatewayId,
              transitGatewayId: c.TransitGatewayId,
              tunnelBytesLastWindow: tunnelBytes[index],
              metricWindowHours: this.windowHours,
              detectedAt: now,
              tags: Object.fromEntries((c.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
              monthlyCostUsd,
            }),
        )
        .filter((c) => this.policy.evaluate(c, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('VPN', err as Error));
    } finally {
      ec2.destroy();
      cw.destroy();
    }
  }

  private async sumTunnelBytes(
    cw: CloudWatchClient,
    vpnConnectionId: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<number> {
    const [dataIn, dataOut] = await Promise.all(
      ['TunnelDataIn', 'TunnelDataOut'].map((metricName) =>
        cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/VPN',
            MetricName: metricName,
            Dimensions: [{ Name: 'VpnId', Value: vpnConnectionId }],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: ['Sum'],
          }),
        ),
      ),
    );
    return (dataIn.Datapoints?.[0]?.Sum ?? 0) + (dataOut.Datapoints?.[0]?.Sum ?? 0);
  }
}
