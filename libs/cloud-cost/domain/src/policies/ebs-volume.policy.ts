// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { EbsVolume } from '../entities/ebs-volume.entity';

export class EbsVolumeWastePolicy extends WastePolicy<EbsVolume> {
  protected judge(volume: EbsVolume, now: Date): WasteVerdict {
    if (!volume.isUnattached()) return notWaste('volume is attached');
    // AWS does not expose the detach date: the volume's age is the only available proxy.
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('unattached');
  }
}
