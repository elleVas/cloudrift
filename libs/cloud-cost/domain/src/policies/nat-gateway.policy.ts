// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { NatGateway } from '../entities/nat-gateway.entity';

export class NatGatewayWastePolicy extends WastePolicy<NatGateway> {
  protected judge(gateway: NatGateway, now: Date): WasteVerdict {
    if (!gateway.isIdle()) return notWaste('has outbound traffic');
    // A gateway younger than the grace period might simply
    // not have received traffic yet (e.g. a newly created environment).
    if (this.isWithinGracePeriod(gateway.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero traffic in last ${gateway.metricWindowHours}h`);
  }
}
