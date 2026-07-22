// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { MskCluster } from '../entities/msk-cluster.entity';

export class MskIdleClusterPolicy extends WastePolicy<MskCluster> {
  protected judge(cluster: MskCluster, now: Date): WasteVerdict {
    if (!cluster.isIdle()) return notWaste('has broker traffic');
    if (this.isWithinGracePeriod(cluster.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero broker traffic in last ${cluster.metricWindowHours}h`);
  }
}
