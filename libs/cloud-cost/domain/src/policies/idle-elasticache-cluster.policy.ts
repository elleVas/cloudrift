// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { IdleElastiCacheCluster } from '../entities/idle-elasticache-cluster.entity';

export class ElastiCacheIdlePolicy extends WastePolicy<IdleElastiCacheCluster> {
  protected judge(cluster: IdleElastiCacheCluster, now: Date): WasteVerdict {
    if (!cluster.isIdle()) return notWaste('has client connections');
    // A just-created cluster might not have received connections yet.
    if (this.isWithinGracePeriod(cluster.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero connections in last ${cluster.metricWindowHours}h`);
  }
}
