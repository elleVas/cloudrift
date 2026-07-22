// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { DocumentDbInstance } from '../entities/documentdb-instance.entity';

export class DocumentDbIdleInstancePolicy extends WastePolicy<DocumentDbInstance> {
  protected judge(instance: DocumentDbInstance, now: Date): WasteVerdict {
    if (!instance.isIdle()) return notWaste('has database connections');
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero connections in last ${instance.metricWindowHours}h`);
  }
}
