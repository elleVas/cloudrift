// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { FsxFileSystem } from '../entities/fsx-file-system.entity';

export class FsxIdleFilesystemPolicy extends WastePolicy<FsxFileSystem> {
  protected judge(fs: FsxFileSystem, now: Date): WasteVerdict {
    if (!fs.isIdle()) return notWaste('has I/O activity');
    if (this.isWithinGracePeriod(fs.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero I/O in last ${fs.metricWindowHours}h`);
  }
}
