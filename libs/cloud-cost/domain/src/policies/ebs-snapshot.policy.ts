// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { EbsSnapshot } from '../entities/ebs-snapshot.entity';

export class EbsSnapshotWastePolicy extends WastePolicy<EbsSnapshot> {
  protected judge(snapshot: EbsSnapshot, now: Date): WasteVerdict {
    if (!snapshot.isOrphan()) return notWaste('source volume still exists');
    if (snapshot.boundToAmiId) {
      // A snapshot referenced by a registered AMI is not deletable.
      return notWaste(`in use by AMI ${snapshot.boundToAmiId}`);
    }
    if (this.isWithinGracePeriod(snapshot.startTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('source volume deleted');
  }
}
