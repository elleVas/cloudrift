// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { RdsManualSnapshotOld } from '../entities/rds-manual-snapshot-old.entity';

export class RdsManualSnapshotOldPolicy extends WastePolicy<RdsManualSnapshotOld> {
  protected judge(snapshot: RdsManualSnapshotOld, now: Date): WasteVerdict {
    if (this.isWithinGracePeriod(snapshot.snapshotCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`manual snapshot ${this.ageInDays(snapshot.snapshotCreateTime, now).toFixed(0)}d old`);
  }
}
