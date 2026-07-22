// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { NeptuneInstance } from '../entities/neptune-instance.entity';

export class NeptuneIdleInstancePolicy extends WastePolicy<NeptuneInstance> {
  protected judge(instance: NeptuneInstance, now: Date): WasteVerdict {
    if (!instance.isIdle()) return notWaste('has query traffic');
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero query traffic in last ${instance.metricWindowHours}h`);
  }
}
