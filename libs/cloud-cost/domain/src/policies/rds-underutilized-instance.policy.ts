// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { RdsUnderutilizedInstance } from '../entities/rds-underutilized-instance.entity';

export class RdsUnderutilizedPolicy extends WastePolicy<RdsUnderutilizedInstance> {
  /** maxCpuPercent: maximum CPU threshold below which the RDS instance is underutilized. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 5) {
    super(options);
  }

  protected judge(instance: RdsUnderutilizedInstance, now: Date): WasteVerdict {
    if (instance.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    // A just-created instance might not have accumulated real traffic yet.
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`max CPU ${instance.maxCpuPercent.toFixed(1)}% over ${instance.windowDays}d`);
  }
}
