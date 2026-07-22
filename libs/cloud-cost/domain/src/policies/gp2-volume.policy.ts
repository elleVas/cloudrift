// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { Gp2Volume } from '../entities/gp2-volume.entity';

export class EbsGp2UpgradePolicy extends WastePolicy<Gp2Volume> {
  protected judge(volume: Gp2Volume, now: Date): WasteVerdict {
    // The server-side prefilter already guarantees volume-type=gp2 in-use;
    // we only apply the grace period so as not to flag resources that
    // were just created (infrastructure still being set up).
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('gp2 volume upgradeable to gp3');
  }
}
