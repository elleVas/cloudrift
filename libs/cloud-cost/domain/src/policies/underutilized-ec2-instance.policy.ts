// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { UnderutilizedEc2Instance } from '../entities/underutilized-ec2-instance.entity';

export class Ec2UnderutilizedPolicy extends WastePolicy<UnderutilizedEc2Instance> {
  /** maxCpuPercent: maximum CPU threshold below which the instance is underutilized. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 5) {
    super(options);
  }

  protected judge(instance: UnderutilizedEc2Instance, now: Date): WasteVerdict {
    if (instance.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    // A just-launched instance might not have accumulated real traffic yet.
    if (this.isWithinGracePeriod(instance.launchTime, now)) {
      return notWaste(`launched less than ${this.minAgeDays}d ago`);
    }
    return waste(`max CPU ${instance.maxCpuPercent.toFixed(1)}% over ${instance.windowDays}d`);
  }
}
