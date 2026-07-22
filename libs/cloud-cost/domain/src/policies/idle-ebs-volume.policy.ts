// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { IdleEbsVolume } from '../entities/idle-ebs-volume.entity';

export class EbsIdlePolicy extends WastePolicy<IdleEbsVolume> {
  /** maxOps: threshold of total I/O operations below which the volume is idle. */
  constructor(options: WastePolicyOptions = {}, private readonly maxOps = 0) {
    super(options);
  }

  protected judge(volume: IdleEbsVolume, now: Date): WasteVerdict {
    if (volume.totalOps() > this.maxOps) return notWaste('has I/O activity');
    // A newly created volume might not have received I/O yet.
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero I/O in last ${volume.metricWindowHours}h`);
  }
}
