// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { EfsFileSystem } from '../entities/efs-file-system.entity';

export class EfsUnusedPolicy extends WastePolicy<EfsFileSystem> {
  /** maxIoBytes: total I/O threshold below which a mounted file system is idle. */
  constructor(options: WastePolicyOptions = {}, private readonly maxIoBytes = 0) {
    super(options);
  }

  protected judge(fs: EfsFileSystem, now: Date): WasteVerdict {
    const idle = !fs.hasNoMountTargets() && fs.ioBytesLastWindow <= this.maxIoBytes;
    if (!fs.hasNoMountTargets() && !idle) return notWaste('has I/O activity');
    if (this.isWithinGracePeriod(fs.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return fs.hasNoMountTargets() ? waste('no mount targets') : waste(`zero I/O in last ${fs.metricWindowHours}h`);
  }
}
