// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { RedshiftCluster } from '../entities/redshift-cluster.entity';

export class RedshiftIdleClusterPolicy extends WastePolicy<RedshiftCluster> {
  protected judge(cluster: RedshiftCluster, now: Date): WasteVerdict {
    if (!cluster.isIdle()) return notWaste('has database connections');
    if (this.isWithinGracePeriod(cluster.clusterCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero connections in last ${cluster.metricWindowHours}h`);
  }
}
