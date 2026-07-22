// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { VpnConnection } from '../entities/vpn-connection.entity';

export class VpnConnectionIdlePolicy extends WastePolicy<VpnConnection> {
  protected judge(connection: VpnConnection): WasteVerdict {
    // DescribeVpnConnections exposes no creation date: no grace period applicable.
    return connection.isIdle()
      ? waste(`zero tunnel traffic in last ${connection.metricWindowHours}h`)
      : notWaste('has tunnel traffic');
  }
}
